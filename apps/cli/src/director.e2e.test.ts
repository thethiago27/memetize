import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_ANALYZER_DIR } from '@memetize/audio-analyzer';
import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { ingestAsset } from '@memetize/media-catalog';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import {
  directorDebugFile,
  effectsDebugFile,
  generateTimeline,
  getLatestEditWindow,
  getLatestTimeline,
  getProject,
  getProjectAudio,
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

async function makeMovingClip(path: string, durationSeconds: number): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=640x360:r=30:d=${durationSeconds}`,
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

function assertContinuous(timeline: Timeline): void {
  expect(timeline.clips.length).toBeGreaterThan(0);
  expect(timeline.clips[0]?.timeline.startMs).toBe(0);
  for (let index = 1; index < timeline.clips.length; index += 1) {
    expect(timeline.clips[index - 1]?.timeline.endMs).toBe(timeline.clips[index]?.timeline.startMs);
  }
  expect(timeline.clips.at(-1)?.timeline.endMs).toBe(timeline.durationMs);
  for (const clip of timeline.clips) {
    expect(clip.source.endMs - clip.source.startMs).toBe(
      clip.timeline.endMs - clip.timeline.startMs,
    );
  }
}

describe.skipIf(!handle || !ffmpegAvailable || !pyEnvReady)('director pipeline (e2e)', () => {
  let tmp: string;
  let config: AppConfig;
  let orchestrator: Orchestrator;
  let shortSong: string;
  let longSong: string;

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
    shortSong = join(tmp, 'short.mp3');
    longSong = join(tmp, 'long.mp3');
    await makeSilentClip(shortSong, 6);
    await makeSilentClip(longSong, 75);
    await truncateAll(db);
    for (const index of [0, 1, 2]) {
      const clipPath = join(tmp, `clip-${index}.mp4`);
      await makeMovingClip(clipPath, 8);
      const { asset } = await ingestAsset({ db, config, filePath: clipPath });
      const outcomes = await orchestrator.drain({ entityId: asset.id });
      expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    }
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('covers a short track at its natural duration with a continuous timeline', async () => {
    const lyricsPath = join(tmp, 'song.lrc');
    await writeFile(
      lyricsPath,
      ['[00:00.00]hello from the fixture', '[00:03.00]this is the payoff line'].join('\n'),
    );
    const { project } = await ingestProject({ db, config, filePath: shortSong, lyricsPath });
    const audio = await getProjectAudio(db, project.id);
    const shortTrackDurationMs = audio?.durationMs ?? 0;

    const outcomes = await orchestrator.drain({ entityId: project.id });
    const types = outcomes.map((outcome) => outcome.job.type);
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
    const matchBySegment = new Map(matches.map((match) => [match.segmentId, match]));
    const segmentsWithShortlist = matches.filter((match) => match.shortlist.length > 0);

    const versions = await listTimelineVersions(db, project.id);
    expect(versions).toHaveLength(3);
    expect(versions[0]?.version).toBe(3);

    const timeline = await getLatestTimeline(db, project.id);
    expect(timeline).toBeTruthy();
    expect(timeline?.data.durationMs).toBe(shortTrackDurationMs);
    expect(timeline?.data.audio.sourceStartMs).toBe(0);
    if (timeline) assertContinuous(timeline.data);

    for (const clip of timeline?.data.clips ?? []) {
      expect(Number.isInteger(clip.timeline.startMs)).toBe(true);
      expect(Number.isInteger(clip.timeline.endMs)).toBe(true);
      expect(Number.isInteger(clip.source.startMs)).toBe(true);
      expect(Number.isInteger(clip.source.endMs)).toBe(true);
      const match = matchBySegment.get(clip.reason.segmentId);
      expect(match).toBeTruthy();
      const inFunnel =
        match?.shortlist.some((entry) => entry.momentId === clip.momentId) ||
        match?.ranked.some((entry) => entry.momentId === clip.momentId);
      expect(inFunnel).toBe(true);
    }

    const tlFile = timelineFile(config, project.id);
    const onDisk = JSON.parse(await readFile(tlFile.absolute, 'utf8'));
    expect(Timeline.safeParse(onDisk).success).toBe(true);

    const directorDebug = JSON.parse(
      await readFile(directorDebugFile(config, project.id).absolute, 'utf8'),
    );
    expect(directorDebug.projectId).toBe(project.id);
    expect(Array.isArray(directorDebug.picks)).toBe(true);
    expect(directorDebug.picks).toHaveLength(segmentsWithShortlist.length);
    // Editorial memory is always handed to the Director, empty on a fresh install.
    expect(directorDebug.promptVersion).toBe('v4');
    expect(directorDebug.memory).toEqual({ lessons: [], examples: [] });

    const punchlineSegmentIds = new Set(
      narrative
        .filter((segment) => ['payoff', 'punchline', 'climax'].includes(segment.narrativeFunction))
        .map((segment) => segment.id),
    );
    const punchlineClips = (timeline?.data.clips ?? []).filter((clip) =>
      punchlineSegmentIds.has(clip.reason.segmentId),
    );
    expect(punchlineClips.length).toBeGreaterThan(0);
    expect(punchlineClips[0]?.effects[0]?.type).toBe('zoom');

    const effectsDebug = JSON.parse(
      await readFile(effectsDebugFile(config, project.id).absolute, 'utf8'),
    );
    expect(effectsDebug.projectId).toBe(project.id);
    expect(Array.isArray(effectsDebug.planned)).toBe(true);
    expect(effectsDebug.planned.length).toBeGreaterThan(0);

    const more = await orchestrator.drain({ entityId: project.id });
    expect(more).toHaveLength(0);
    expect(await listTimelineVersions(db, project.id)).toHaveLength(3);

    await generateTimeline(db, project.id);
    const afterGenerate = await orchestrator.drain({ entityId: project.id });
    expect(afterGenerate.map((outcome) => outcome.job.type)).toEqual([
      'DIRECTOR',
      'TIMING',
      'EFFECTS',
    ]);
    expect(afterGenerate.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    const versionsAfterGenerate = await listTimelineVersions(db, project.id);
    expect(versionsAfterGenerate.map((v) => v.version).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await getProject(db, project.id))?.status).toBe('TIMELINE_READY');
    expect(narrative.length).toBeGreaterThanOrEqual(1);

    await reprocessProject(db, project.id, 'director');
    const afterReprocess = await orchestrator.drain({ entityId: project.id });
    expect(afterReprocess.map((outcome) => outcome.job.type)).toEqual([
      'DIRECTOR',
      'TIMING',
      'EFFECTS',
    ]);
    const versionsAfterReprocess = await listTimelineVersions(db, project.id);
    expect(versionsAfterReprocess.map((v) => v.version).sort()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect((await getProject(db, project.id))?.status).toBe('TIMELINE_READY');
  }, 180_000);

  it('selects a sixty-second window for a long track and covers it continuously', async () => {
    const { project } = await ingestProject({ db, config, filePath: longSong });
    const outcomes = await orchestrator.drain({ entityId: project.id });
    expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    const window = await getLatestEditWindow(db, project.id);
    const timeline = await getLatestTimeline(db, project.id);
    expect(window?.durationMs).toBe(60_000);
    expect(timeline?.data.durationMs).toBe(60_000);
    expect(timeline?.data.audio.sourceStartMs).toBeGreaterThanOrEqual(0);
    if (timeline) assertContinuous(timeline.data);
  }, 180_000);

  it('fails with INSUFFICIENT_CATALOG when the project has no catalog at all', async () => {
    await truncateAll(db);

    const { project } = await ingestProject({ db, config, filePath: shortSong });
    const outcomes = await orchestrator.drain({ entityId: project.id });
    const director = outcomes.find((outcome) => outcome.job.type === 'DIRECTOR');

    expect((await getProject(db, project.id))?.status).toBe('FAILED');
    expect(director?.status).toBe('FAILED');
    expect(director?.error?.code).toBe('INSUFFICIENT_CATALOG');
    expect(await getLatestTimeline(db, project.id)).toBeUndefined();
  }, 60_000);
});
