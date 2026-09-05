import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_ANALYZER_DIR } from '@memetize/audio-analyzer';
import {
  createTestDatabase,
  type Database,
  deleteProjectSubtitles,
  truncateAll,
} from '@memetize/database';
import { ingestAsset, probeVideo } from '@memetize/media-catalog';
import type { Orchestrator } from '@memetize/orchestrator';
import {
  effectsDebugFile,
  getLatestRender,
  getLatestTimeline,
  getProject,
  getSubtitles,
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

/** Near-white pixels in the burned-in caption band (1080×1920, baseline 0.78). */
async function countCaptionBrightPixels(videoPath: string, atSeconds: number): Promise<number> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      atSeconds.toFixed(3),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      'crop=1080:240:0:1360',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 1080 * 240 * 3 + 4096 },
  );
  const pixels = stdout as Buffer;
  let bright = 0;
  for (let index = 0; index + 2 < pixels.length; index += 3) {
    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    if (r > 220 && g > 220 && b > 220) {
      bright += 1;
    }
  }
  return bright;
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

  it('burns fixture captions into a lyrics render and refuses when the subtitles row is missing', async () => {
    await truncateAll(db);
    for (const index of [0, 1, 2]) {
      const clipPath = join(tmp, `caption-clip-${index}.mp4`);
      await makeMovingClip(clipPath, 8);
      const { asset } = await ingestAsset({ db, config, filePath: clipPath });
      const outcomes = await orchestrator.drain({ entityId: asset.id });
      expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    }

    const lyricsPath = join(tmp, 'captions.lrc');
    await writeFile(
      lyricsPath,
      ['[00:01.00]HELLO WORLD CAPTION TEST', '[00:03.00]SECOND LINE HERE NOW'].join('\n'),
    );

    const { project: lyricsProject } = await ingestProject({
      db,
      config,
      filePath: songFixture,
      lyricsPath,
    });
    const lyricsCreate = await orchestrator.drain({ entityId: lyricsProject.id });
    expect(lyricsCreate.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    expect(lyricsCreate.some((outcome) => outcome.job.type === 'SUBTITLES')).toBe(true);
    const captions = await getSubtitles(db, lyricsProject.id);
    expect(captions?.translated).toBe(false);
    expect(captions?.lines.length).toBeGreaterThan(0);

    await renderProject(db, lyricsProject.id);
    const lyricsRender = await orchestrator.drain({ entityId: lyricsProject.id });
    expect(lyricsRender.map((outcome) => outcome.job.type)).toEqual(['RENDER']);
    expect(lyricsRender[0]?.status).toBe('COMPLETED');

    const lyricsFile = resolveStorage(
      config,
      (await getLatestRender(db, lyricsProject.id))?.path ?? '',
    );
    const lyricsProbe = await probeVideo(lyricsFile);
    expect(lyricsProbe.width).toBe(1080);
    expect(lyricsProbe.height).toBe(1920);
    expect(Math.abs(lyricsProbe.durationMs - 6000)).toBeLessThanOrEqual(200);

    const lyricsDebug = JSON.parse(
      await readFile(renderDebugFile(config, lyricsProject.id).absolute, 'utf8'),
    );
    expect(lyricsDebug.subtitles).toMatchObject({
      lineCount: captions?.lines.length,
      cueCount: expect.any(Number),
      translated: false,
      model: 'fixture',
    });
    expect(lyricsDebug.subtitles.cueCount).toBeGreaterThan(0);
    expect(String(lyricsDebug.graph.filterComplex)).toContain('[vjoin]');
    expect(String(lyricsDebug.graph.filterComplex)).toContain('overlay=');

    const { project: instrumentalProject } = await ingestProject({
      db,
      config,
      filePath: songFixture,
    });
    const instrumentalCreate = await orchestrator.drain({ entityId: instrumentalProject.id });
    expect(instrumentalCreate.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    await renderProject(db, instrumentalProject.id);
    const instrumentalRender = await orchestrator.drain({ entityId: instrumentalProject.id });
    expect(instrumentalRender[0]?.status).toBe('COMPLETED');

    const instrumentalFile = resolveStorage(
      config,
      (await getLatestRender(db, instrumentalProject.id))?.path ?? '',
    );
    const instrumentalDebug = JSON.parse(
      await readFile(renderDebugFile(config, instrumentalProject.id).absolute, 'utf8'),
    );
    expect(instrumentalDebug.subtitles).toBeNull();
    expect(String(instrumentalDebug.graph.filterComplex)).not.toContain('overlay=');

    const captionedBright = await countCaptionBrightPixels(lyricsFile, 1.5);
    const instrumentalBright = await countCaptionBrightPixels(instrumentalFile, 1.5);
    expect(captionedBright).toBeGreaterThan(instrumentalBright);

    await deleteProjectSubtitles(db, lyricsProject.id);
    expect(await getSubtitles(db, lyricsProject.id)).toBeUndefined();
    await renderProject(db, lyricsProject.id);
    const missing = await orchestrator.drain({ entityId: lyricsProject.id });
    expect(missing.map((outcome) => outcome.job.type)).toEqual(['RENDER']);
    expect(missing[0]?.status).toBe('FAILED');
    expect(missing[0]?.error?.code).toBe('RENDER_SUBTITLES_MISSING');
  }, 180_000);
});
