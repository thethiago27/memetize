import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_ANALYZER_DIR } from '@memetize/audio-analyzer';
import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { listFeedbackEvents, recordFeedbackEvents } from '@memetize/feedback';
import { ingestAsset } from '@memetize/media-catalog';
import type { Orchestrator } from '@memetize/orchestrator';
import {
  getLatestTimeline,
  getProject,
  ingestProject,
  listNarrativeSegments,
  listSegmentMatches,
  matchDebugFile,
  reprocessProject,
} from '@memetize/projects';
import { createOrchestrator } from '@memetize/runtime';
import { SCENE_DETECTOR_DIR } from '@memetize/scene-detector';
import type { AppConfig } from '@memetize/shared';
import { TRANSCRIPT_DIR } from '@memetize/transcript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const handle = await createTestDatabase();
const db = handle?.db as Database;

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}
const ffmpegAvailable = await hasFfmpeg();
const pyEnvReady =
  existsSync(join(AUDIO_ANALYZER_DIR, '.venv')) &&
  existsSync(join(SCENE_DETECTOR_DIR, '.venv')) &&
  existsSync(join(TRANSCRIPT_DIR, '.venv'));

async function makeSilentClip(path: string, durationSeconds: number): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=44100:cl=mono:d=${durationSeconds}`,
    path,
  ]);
}

async function makeColorClip(path: string, color: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=640x360:d=2:r=30`,
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

describe.skipIf(!handle || !ffmpegAvailable || !pyEnvReady)('matching pipeline (e2e)', () => {
  let tmp: string;
  let config: AppConfig;
  let orchestrator: Orchestrator;
  let songFixture: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-matching-e2e-'));
    config = {
      databaseUrl: 'unused',
      testDatabaseUrl: null,
      rootDir: tmp,
      storageDir: join(tmp, 'storage'),
      storageDirRelative: 'storage',
      resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
      embeddingDimensions: 384,
      providerMode: 'demo',
      providers: {
        transcription: { kind: 'fixture', model: null },
        vision: { kind: 'fixture', model: null },
        llm: { kind: 'fixture', model: null },
        embedding: { kind: 'fixture', model: null },
        audio: { kind: 'fixture', model: null },
      },
    };
    orchestrator = createOrchestrator({ db, config });
    songFixture = join(tmp, 'song.mp3');
    await makeSilentClip(songFixture, 6);
    await truncateAll(db);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('matches narrative segments against a small catalog and produces per-segment shortlists', async () => {
    // Seed a small catalog: 3 distinct clips through to READY (spec sections 14-23).
    const colors = ['red', 'green', 'blue'];
    for (const [index, color] of colors.entries()) {
      const clipPath = join(tmp, `clip-${index}-${color}.mp4`);
      await makeColorClip(clipPath, color);
      const { asset } = await ingestAsset({ db, config, filePath: clipPath });
      const outcomes = await orchestrator.drain({ entityId: asset.id });
      expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    }

    const { project } = await ingestProject({ db, config, filePath: songFixture });

    const outcomes = await orchestrator.drain({ entityId: project.id });
    const types = outcomes.map((outcome) => outcome.job.type);
    // AUDIO_ANALYZE and LYRICS fan out in parallel (relative order unspecified);
    // NARRATIVE only runs once both are done, then chains into MATCH, then
    // DIRECTOR, then TIMING, then EFFECTS (spec sections 32-33).
    expect(types).toHaveLength(7);
    expect(new Set(types.slice(0, 2))).toEqual(new Set(['AUDIO_ANALYZE', 'LYRICS']));
    expect(types[2]).toBe('NARRATIVE');
    expect(types[3]).toBe('MATCH');
    expect(types[4]).toBe('DIRECTOR');
    expect(types[5]).toBe('TIMING');
    expect(types[6]).toBe('EFFECTS');
    expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    const refreshed = await getProject(db, project.id);
    expect(refreshed?.status).toBe('TIMELINE_READY');

    const narrative = await listNarrativeSegments(db, project.id);
    const matches = await listSegmentMatches(db, project.id);
    expect(matches).toHaveLength(narrative.length);

    const matchBySegment = new Map(matches.map((match) => [match.segmentId, match]));
    const seenAssetIds = new Set<string>();
    let lastTopAssetId: string | undefined;
    for (const segment of narrative) {
      const match = matchBySegment.get(segment.id);
      expect(match).toBeTruthy();
      expect(match?.shortlist.length).toBeLessThanOrEqual(6);
      const top = match?.shortlist[0];
      if (top && lastTopAssetId === top.assetId) {
        expect(top.penalties).toContain('same_asset_relaxed');
      }
      lastTopAssetId = top?.assetId;
      for (const entry of match?.shortlist ?? []) {
        expect(entry.momentId).toBeTruthy();
        expect(entry.assetId).toBeTruthy();
        seenAssetIds.add(entry.assetId);
      }
    }
    expect(seenAssetIds.size).toBeLessThanOrEqual(3);

    // The Narrative Analyzer's visualIdeas are the retriever's queries (spec
    // section 28) — the debug snapshot should show them, per segment.
    const debugFile = matchDebugFile(config, project.id);
    const debug = JSON.parse(await readFile(debugFile.absolute, 'utf8')) as {
      segments: { segmentId: string; queries: string[] }[];
    };
    for (const segment of narrative) {
      const debugSegment = debug.segments.find((entry) => entry.segmentId === segment.id);
      expect(debugSegment).toBeTruthy();
      for (const idea of segment.visualIdeas) {
        expect(debugSegment?.queries).toContain(idea);
      }
    }

    // EFFECTS closed the slate: every clip is now a PLACED event in the
    // editorial memory (editorial-memory spec).
    const timeline = await getLatestTimeline(db, project.id);
    const placed = await listFeedbackEvents(db, { projectId: project.id, kinds: ['PLACED'] });
    expect(placed).toHaveLength(timeline?.data.clips.length ?? -1);
    expect(placed.every((event) => event.source === 'SYSTEM' && event.momentId)).toBe(true);

    // Re-ingesting the same bytes creates a *different* project (spec section 41 note).
    const again = await ingestProject({ db, config, filePath: songFixture });
    expect(again.project.id).not.toBe(project.id);

    // Re-draining the first project processes nothing (all jobs COMPLETED).
    const more = await orchestrator.drain({ entityId: project.id });
    expect(more).toHaveLength(0);
    expect(await listSegmentMatches(db, project.id)).toHaveLength(matches.length);
  }, 90_000);

  it('never offers a moment the editor swapped out of a segment again', async () => {
    const colors = ['cyan', 'magenta', 'yellow'];
    for (const [index, color] of colors.entries()) {
      const clipPath = join(tmp, `clip-reject-${index}-${color}.mp4`);
      await makeColorClip(clipPath, color);
      const { asset } = await ingestAsset({ db, config, filePath: clipPath });
      await orchestrator.drain({ entityId: asset.id });
    }
    const { project } = await ingestProject({ db, config, filePath: songFixture });
    await orchestrator.drain({ entityId: project.id });

    const before = await listSegmentMatches(db, project.id);
    const target = before.find((match) => match.retrieved.length >= 2);
    expect(target).toBeTruthy();
    if (!target) return;
    const rejected = target.retrieved[0];
    if (!rejected) throw new Error('unreachable');

    await recordFeedbackEvents(db, [
      {
        kind: 'SWAP_OUT',
        source: 'USER',
        projectId: project.id,
        segmentId: target.segmentId,
        momentId: rejected.momentId,
        assetId: rejected.assetId,
        context: { segmentId: target.segmentId },
      },
    ]);

    await reprocessProject(db, project.id, 'match');
    const outcomes = await orchestrator.drain({ entityId: project.id });
    expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    const after = await listSegmentMatches(db, project.id);
    const refreshed = after.find((match) => match.segmentId === target.segmentId);
    expect(refreshed?.rankerVersion).toBe('2.0.0');
    expect(refreshed?.feedbackCutoffAt).toBeTruthy();
    expect(refreshed?.retrieved.map((entry) => entry.momentId)).not.toContain(rejected.momentId);
    expect(refreshed?.shortlist.map((entry) => entry.momentId)).not.toContain(rejected.momentId);
    // Other segments may still use it: the rule is per segment.
    const elsewhere = after.filter((match) => match.segmentId !== target.segmentId);
    expect(
      elsewhere.some((match) =>
        match.retrieved.some((entry) => entry.momentId === rejected.momentId),
      ),
    ).toBe(true);

    const debug = JSON.parse(
      await readFile(matchDebugFile(config, project.id).absolute, 'utf8'),
    ) as {
      feedback: { eventCount: number };
      segments: { segmentId: string; rejectedMomentIds: string[] }[];
    };
    expect(debug.feedback.eventCount).toBeGreaterThan(0);
    expect(
      debug.segments.find((entry) => entry.segmentId === target.segmentId)?.rejectedMomentIds,
    ).toEqual([rejected.momentId]);
  }, 90_000);

  it('completes MATCH with empty shortlists when the project has no catalog at all', async () => {
    await truncateAll(db);

    const { project } = await ingestProject({ db, config, filePath: songFixture });
    await orchestrator.drain({ entityId: project.id });

    const refreshed = await getProject(db, project.id);
    expect(refreshed?.status).toBe('FAILED');

    const narrative = await listNarrativeSegments(db, project.id);
    const matches = await listSegmentMatches(db, project.id);
    expect(matches).toHaveLength(narrative.length);
    for (const match of matches) {
      expect(match.shortlist).toEqual([]);
    }
    expect(await getLatestTimeline(db, project.id)).toBeUndefined();
  }, 60_000);
});
