import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_ANALYZER_DIR } from '@memetize/audio-analyzer';
import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { ingestAsset } from '@memetize/media-catalog';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import {
  directorDebugFile,
  generateTimeline,
  getLatestTimeline,
  getProject,
  ingestProject,
  listNarrativeSegments,
  listSegmentMatches,
  listTimelineVersions,
  reprocessProject,
  timelineFile,
} from '@memetize/projects';
import { SCENE_DETECTOR_DIR } from '@memetize/scene-detector';
import type { AppConfig } from '@memetize/shared';
import { Timeline } from '@memetize/timeline';
import { TRANSCRIPT_DIR } from '@memetize/transcript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRegistry } from './registry';

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

describe.skipIf(!handle || !ffmpegAvailable || !pyEnvReady)('director pipeline (e2e)', () => {
  let tmp: string;
  let config: AppConfig;
  let orchestrator: Orchestrator;
  let songFixture: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-director-e2e-'));
    config = {
      databaseUrl: 'unused',
      testDatabaseUrl: null,
      rootDir: tmp,
      storageDir: join(tmp, 'storage'),
      storageDirRelative: 'storage',
      resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
      embeddingDimensions: 384,
      providers: {
        transcription: { kind: 'fixture', model: null },
        vision: { kind: 'fixture', model: null },
        llm: { kind: 'fixture', model: null },
        embedding: { kind: 'fixture', model: null },
        audio: { kind: 'fixture', model: null },
      },
    };
    orchestrator = new Orchestrator({
      db,
      config,
      registry: buildRegistry(),
      scheduler: new ResourceScheduler(config.resources),
    });
    songFixture = join(tmp, 'song.mp3');
    await makeSilentClip(songFixture, 6);
    await truncateAll(db);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('picks one clip per segment with a non-empty shortlist and assembles a valid, non-overlapping timeline', async () => {
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
    // DIRECTOR, then TIMING (spec section 32: separate from the Director).
    expect(types).toHaveLength(6);
    expect(new Set(types.slice(0, 2))).toEqual(new Set(['AUDIO_ANALYZE', 'LYRICS']));
    expect(types[2]).toBe('NARRATIVE');
    expect(types[3]).toBe('MATCH');
    expect(types[4]).toBe('DIRECTOR');
    expect(types[5]).toBe('TIMING');
    expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    const refreshed = await getProject(db, project.id);
    expect(refreshed?.status).toBe('TIMELINE_READY');

    const narrative = await listNarrativeSegments(db, project.id);
    const matches = await listSegmentMatches(db, project.id);
    const matchBySegment = new Map(matches.map((match) => [match.segmentId, match]));
    const segmentsWithShortlist = matches.filter((match) => match.shortlist.length > 0);

    // Two versions: the Director's raw v1, and the Timing Optimizer's
    // beat-aligned v2 (spec section 32) — `getLatestTimeline` reads the
    // latter automatically, with no Renderer/CLI code aware of the Timing
    // step at all.
    const versions = await listTimelineVersions(db, project.id);
    expect(versions).toHaveLength(2);
    expect(versions[0]?.version).toBe(2);

    const timeline = await getLatestTimeline(db, project.id);
    expect(timeline).toBeTruthy();
    expect(timeline?.data.clips).toHaveLength(segmentsWithShortlist.length);

    for (const clip of timeline?.data.clips ?? []) {
      expect(Number.isInteger(clip.timeline.startMs)).toBe(true);
      expect(Number.isInteger(clip.timeline.endMs)).toBe(true);
      expect(Number.isInteger(clip.source.startMs)).toBe(true);
      expect(Number.isInteger(clip.source.endMs)).toBe(true);
      expect(clip.effects).toEqual([]);

      const match = matchBySegment.get(clip.reason.segmentId);
      expect(match).toBeTruthy();
      expect(match?.shortlist.some((entry) => entry.momentId === clip.momentId)).toBe(true);
    }

    // Clips are ordered and never overlap (endMs of clip i <= startMs of clip i+1).
    const clips = timeline?.data.clips ?? [];
    for (let i = 0; i < clips.length - 1; i += 1) {
      const current = clips[i];
      const next = clips[i + 1];
      expect(current?.timeline.endMs).toBeLessThanOrEqual(next?.timeline.startMs ?? 0);
    }

    // The official document on disk parses with the Timeline Zod schema (spec section 64).
    const tlFile = timelineFile(config, project.id);
    const onDisk = JSON.parse(await readFile(tlFile.absolute, 'utf8'));
    expect(Timeline.safeParse(onDisk).success).toBe(true);

    const directorDebug = JSON.parse(
      await readFile(directorDebugFile(config, project.id).absolute, 'utf8'),
    );
    expect(directorDebug.projectId).toBe(project.id);
    expect(Array.isArray(directorDebug.picks)).toBe(true);
    expect(directorDebug.picks).toHaveLength(segmentsWithShortlist.length);

    // Re-draining processes nothing (all jobs COMPLETED) and creates no new version.
    const more = await orchestrator.drain({ entityId: project.id });
    expect(more).toHaveLength(0);
    expect(await listTimelineVersions(db, project.id)).toHaveLength(2);

    // `project generate` forces a new DIRECTOR run, which chains into a
    // fresh TIMING run in the same drain — two new versions (v3 raw, v4 aligned).
    await generateTimeline(db, project.id);
    const afterGenerate = await orchestrator.drain({ entityId: project.id });
    expect(afterGenerate.map((outcome) => outcome.job.type)).toEqual(['DIRECTOR', 'TIMING']);
    expect(afterGenerate.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    const versionsAfterGenerate = await listTimelineVersions(db, project.id);
    expect(versionsAfterGenerate.map((v) => v.version).sort()).toEqual([1, 2, 3, 4]);
    expect((await getProject(db, project.id))?.status).toBe('TIMELINE_READY');
    expect(narrative.length).toBeGreaterThanOrEqual(1);

    // `reprocess --from director` also forces a new DIRECTOR + TIMING pair (v5, v6).
    await reprocessProject(db, project.id, 'director');
    const afterReprocess = await orchestrator.drain({ entityId: project.id });
    expect(afterReprocess.map((outcome) => outcome.job.type)).toEqual(['DIRECTOR', 'TIMING']);
    const versionsAfterReprocess = await listTimelineVersions(db, project.id);
    expect(versionsAfterReprocess.map((v) => v.version).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await getProject(db, project.id))?.status).toBe('TIMELINE_READY');
  }, 90_000);

  it('completes with an empty timeline when the project has no catalog at all', async () => {
    await truncateAll(db);

    const { project } = await ingestProject({ db, config, filePath: songFixture });
    await orchestrator.drain({ entityId: project.id });

    const refreshed = await getProject(db, project.id);
    expect(refreshed?.status).toBe('TIMELINE_READY');

    // Even an empty timeline goes through TIMING (v1 raw -> v2 pass-through);
    // `getLatestTimeline` returns the latter.
    const timeline = await getLatestTimeline(db, project.id);
    expect(timeline?.version).toBe(2);
    expect(timeline?.data.clips).toEqual([]);
  }, 60_000);
});
