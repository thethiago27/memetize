import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_ANALYZER_DIR } from '@memetize/audio-analyzer';
import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { ingestAsset, probeVideo } from '@memetize/media-catalog';
import type { Orchestrator } from '@memetize/orchestrator';
import {
  effectsDebugFile,
  getLatestRender,
  getLatestTimeline,
  getProject,
  ingestProject,
  listRenders,
  renderDebugFile,
  renderProject,
  resolveStorage,
} from '@memetize/projects';
import { isFadeStyle, isOverlapStyle, transitionOutOf } from '@memetize/renderer';
import { createOrchestrator } from '@memetize/runtime';
import { SCENE_DETECTOR_DIR } from '@memetize/scene-detector';
import type { AppConfig } from '@memetize/shared';
import type { Timeline } from '@memetize/timeline';
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

/** `black_start:X black_end:Y` pairs from `blackdetect`, in ms. */
function parseBlackIntervals(stderr: string): { startMs: number; endMs: number }[] {
  const intervals: { startMs: number; endMs: number }[] = [];
  const pattern = /black_start:([\d.]+) black_end:([\d.]+)/g;
  for (const match of stderr.matchAll(pattern)) {
    intervals.push({
      startMs: Math.round(Number(match[1]) * 1000),
      endMs: Math.round(Number(match[2]) * 1000),
    });
  }
  return intervals;
}

/** Output-time windows where a `dip_black` boundary may legitimately be black. */
function dipBlackWindows(timeline: Timeline): { startMs: number; endMs: number }[] {
  const sorted = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);
  return sorted.flatMap((clip, index) => {
    const transition = transitionOutOf(clip, index === sorted.length - 1);
    if (transition.style !== 'dip_black') return [];
    const half = transition.durationMs / 2;
    return [{ startMs: clip.timeline.endMs - half, endMs: clip.timeline.endMs + half }];
  });
}

function assertContinuous(timeline: Timeline): void {
  expect(timeline.clips.length).toBeGreaterThan(0);
  expect(timeline.clips[0]?.timeline.startMs).toBe(0);
  for (let index = 1; index < timeline.clips.length; index += 1) {
    expect(timeline.clips[index - 1]?.timeline.endMs).toBe(timeline.clips[index]?.timeline.startMs);
  }
  expect(timeline.clips.at(-1)?.timeline.endMs).toBe(timeline.durationMs);
  for (const clip of timeline.clips) {
    // A sped-up clip legitimately carries more source than its slot; none may carry less.
    expect(clip.source.endMs - clip.source.startMs).toBeGreaterThanOrEqual(
      clip.timeline.endMs - clip.timeline.startMs,
    );
  }
}

async function probeStartTimes(path: string): Promise<{
  durationSeconds: number;
  videoStart: number;
  audioStart: number;
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_entries',
    'format=duration:stream=start_time,codec_type',
    path,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; start_time?: string }[];
  };
  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
  return {
    durationSeconds: Number(data.format?.duration ?? 0),
    videoStart: Number(video?.start_time ?? Number.NaN),
    audioStart: Number(audio?.start_time ?? Number.NaN),
  };
}

async function detectBlack(path: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-i',
        path,
        '-vf',
        'blackdetect=d=0.05:pix_th=0.10',
        '-an',
        '-f',
        'null',
        '-',
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return stderr;
  } catch (error) {
    const failed = error as { stderr?: string };
    return failed.stderr ?? '';
  }
}

describe.skipIf(!handle || !ffmpegAvailable || !pyEnvReady)('renderer pipeline (e2e)', () => {
  let tmp: string;
  let config: AppConfig;
  let orchestrator: Orchestrator;
  let songFixture: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-renderer-e2e-'));
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

  it('renders a catalog-backed timeline into a valid 1080x1920@30 MP4 and supports a second version', async () => {
    for (const index of [0, 1, 2]) {
      const clipPath = join(tmp, `clip-${index}.mp4`);
      await makeMovingClip(clipPath, 8);
      const { asset } = await ingestAsset({ db, config, filePath: clipPath });
      const outcomes = await orchestrator.drain({ entityId: asset.id });
      expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    }

    const { project } = await ingestProject({ db, config, filePath: songFixture });
    const createOutcomes = await orchestrator.drain({ entityId: project.id });
    expect(createOutcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    // `project create` never renders — it stops at TIMELINE_READY (spec section 42).
    expect((await getProject(db, project.id))?.status).toBe('TIMELINE_READY');
    expect(createOutcomes.some((outcome) => outcome.job.type === 'RENDER')).toBe(false);

    await renderProject(db, project.id);
    const renderOutcomes = await orchestrator.drain({ entityId: project.id });
    expect(renderOutcomes.map((outcome) => outcome.job.type)).toEqual(['RENDER']);
    expect(renderOutcomes[0]?.status).toBe('COMPLETED');

    expect((await getProject(db, project.id))?.status).toBe('COMPLETED');

    const renders = await listRenders(db, project.id);
    expect(renders).toHaveLength(1);
    const render = renders[0];
    expect(render?.version).toBe(1);
    const renderPath = resolveStorage(config, render?.path ?? '');
    expect(existsSync(renderPath)).toBe(true);

    const probe = await probeVideo(renderPath);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    expect(probe.fpsMilli).toBe(30000);
    expect(probe.audioCodec).toBeTruthy();
    expect(Math.abs(probe.durationMs - 6000)).toBeLessThanOrEqual(200);

    const timeline = await getLatestTimeline(db, project.id);
    if (timeline) assertContinuous(timeline.data);

    const starts = await probeStartTimes(renderPath);
    expect(Math.abs(starts.durationSeconds * 1000 - 6000)).toBeLessThanOrEqual(200);
    expect(Math.abs(starts.videoStart)).toBeLessThan(1 / 30);
    expect(Math.abs(starts.audioStart)).toBeLessThan(1 / 30);
    expect(await detectBlack(renderPath)).not.toMatch(/black_start/);

    const debug = JSON.parse(await readFile(renderDebugFile(config, project.id).absolute, 'utf8'));
    expect(Array.isArray(debug.args)).toBe(true);
    expect(debug.validation.valid).toBe(true);
    expect(debug.graph.filterComplex).not.toContain('color=c=black');
    expect(debug.graph.filterComplex).not.toContain('tpad=stop_mode=clone:stop_duration');
    expect(debug.performance).toMatchObject({
      clipCount: timeline?.data.clips.length,
      uniqueSourceCount: expect.any(Number),
    });
    expect(debug.performance.ffmpegMs).toBeGreaterThan(0);

    // Re-draining processes nothing (RENDER already COMPLETED) and never creates v2.
    const more = await orchestrator.drain({ entityId: project.id });
    expect(more).toHaveLength(0);
    expect(await listRenders(db, project.id)).toHaveLength(1);

    // A second `renderProject` forces v2 without touching v1.
    await renderProject(db, project.id);
    const secondOutcomes = await orchestrator.drain({ entityId: project.id });
    expect(secondOutcomes.map((outcome) => outcome.job.type)).toEqual(['RENDER']);
    expect(secondOutcomes[0]?.status).toBe('COMPLETED');

    const rendersAfterSecond = await listRenders(db, project.id);
    expect(rendersAfterSecond.map((r) => r.version).sort()).toEqual([1, 2]);
    const v1 = rendersAfterSecond.find((r) => r.version === 1);
    expect(v1?.path).toBe(render?.path);
    expect(existsSync(resolveStorage(config, v1?.path ?? ''))).toBe(true);
    const v2 = rendersAfterSecond.find((r) => r.version === 2);
    expect(v2?.path).toContain('render_002.mp4');
    expect((await getProject(db, project.id))?.status).toBe('COMPLETED');
  }, 120_000);

  it('fails at director with INSUFFICIENT_CATALOG and never renders when there is no catalog', async () => {
    await truncateAll(db);

    const { project } = await ingestProject({ db, config, filePath: songFixture });
    const outcomes = await orchestrator.drain({ entityId: project.id });
    const director = outcomes.find((outcome) => outcome.job.type === 'DIRECTOR');

    expect((await getProject(db, project.id))?.status).toBe('FAILED');
    expect(director?.status).toBe('FAILED');
    expect(director?.error?.code).toBe('INSUFFICIENT_CATALOG');
    expect(outcomes.some((outcome) => outcome.job.type === 'RENDER')).toBe(false);
    expect(await getLatestRender(db, project.id)).toBeUndefined();
  }, 60_000);

  it('renders every cut style the styled fixture proposes and keeps black inside dip_black windows', async () => {
    await truncateAll(db);
    const styledConfig: AppConfig = {
      ...config,
      providers: { ...config.providers, llm: { kind: 'fixture', model: 'styled' } },
    };
    const styled = createOrchestrator({ db, config: styledConfig });

    for (const index of [0, 1, 2]) {
      const clipPath = join(tmp, `styled-clip-${index}.mp4`);
      await makeMovingClip(clipPath, 8);
      const { asset } = await ingestAsset({ db, config: styledConfig, filePath: clipPath });
      const outcomes = await styled.drain({ entityId: asset.id });
      expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    }

    const { project } = await ingestProject({ db, config: styledConfig, filePath: songFixture });
    const createOutcomes = await styled.drain({ entityId: project.id });
    expect(createOutcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    const timelineVersion = await getLatestTimeline(db, project.id);
    expect(timelineVersion).toBeDefined();
    const timeline = timelineVersion?.data as Timeline;
    assertContinuous(timeline);

    // The Director proposed styles, and every clip carries a resolution.
    expect(timeline.clips.some((clip) => clip.direction.transitionOut !== 'hard')).toBe(true);
    expect(timeline.clips.every((clip) => clip.transitionOut !== undefined)).toBe(true);
    const effectsDebug = JSON.parse(
      await readFile(effectsDebugFile(config, project.id).absolute, 'utf8'),
    );
    expect(Array.isArray(effectsDebug.cuts)).toBe(true);
    expect(effectsDebug.cuts.length).toBeGreaterThan(0);

    await renderProject(db, project.id);
    const renderOutcomes = await styled.drain({ entityId: project.id });
    expect(renderOutcomes.map((outcome) => outcome.status)).toEqual(['COMPLETED']);

    const render = await getLatestRender(db, project.id);
    const renderPath = resolveStorage(config, render?.path ?? '');
    const probe = await probeVideo(renderPath);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    expect(probe.fpsMilli).toBe(30000);
    expect(Math.abs(probe.durationMs - 6000)).toBeLessThanOrEqual(200);

    // The graph agrees with the resolved timeline.
    const sorted = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);
    const resolved = sorted.map((clip, index) =>
      transitionOutOf(clip, index === sorted.length - 1),
    );
    const debug = JSON.parse(await readFile(renderDebugFile(config, project.id).absolute, 'utf8'));
    const filter = String(debug.graph.filterComplex);
    expect(filter.includes('xfade=')).toBe(resolved.some((t) => isOverlapStyle(t.style)));
    expect(filter.includes('fade=t=out')).toBe(resolved.some((t) => isFadeStyle(t.style)));
    expect(filter.includes('tpad=stop_mode=clone:stop_duration')).toBe(
      timeline.clips.some((clip) => clip.effects.some((effect) => effect.type === 'hold')),
    );

    // Black frames only where a dip to black was declared.
    const windows = dipBlackWindows(timeline);
    const black = parseBlackIntervals(await detectBlack(renderPath));
    for (const interval of black) {
      const inside = windows.some(
        (window) => interval.startMs >= window.startMs - 50 && interval.endMs <= window.endMs + 50,
      );
      expect(
        inside,
        `black ${interval.startMs}-${interval.endMs}ms outside dip_black windows`,
      ).toBe(true);
    }
  }, 180_000);
});
