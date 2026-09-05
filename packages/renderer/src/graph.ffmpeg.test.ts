import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  DEFAULT_DIRECTION,
  DEFAULT_TRANSFORM,
  Timeline,
  type TimelineClip,
  type TimelineTransitionOut,
} from '@memetize/timeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFfmpegGraph, toFfmpegArgs } from './graph';
import type { ResolvedAssets } from './types';

const run = promisify(execFile);

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

const available = await ffmpegAvailable();

/**
 * F04: a real FFmpeg render must succeed for every mix of hard cuts and
 * crossfades — most importantly a hard cut followed by a crossfade, which
 * previously failed with "time base do not match" because the concat feeding the
 * xfade had reset the time base. We render synthetic media and assert both a
 * zero exit code and a container/stream duration close to the timeline length.
 */
describe.skipIf(!available)('buildFfmpegGraph: real FFmpeg render (F04)', () => {
  let dir: string;
  const audioPath = () => join(dir, 'audio.wav');
  const videoPath = (i: number) => join(dir, `src_${i}.mp4`);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memetize-f04-'));
    // One long audio bed and five distinct 5s source clips.
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', audioPath()]);
    for (let i = 1; i <= 5; i += 1) {
      await run('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=duration=5:size=320x240:rate=30`,
        '-pix_fmt',
        'yuv420p',
        videoPath(i),
      ]);
    }
  }, 60_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function clip(id: string, index: number, transitionOut?: TimelineTransitionOut): TimelineClip {
    const start = index * 2000;
    return {
      id,
      momentId: `mom_${id}`,
      timeline: { startMs: start, endMs: start + 2000 },
      source: { assetId: `ast_${index}`, startMs: 1000, endMs: 3000 },
      transform: DEFAULT_TRANSFORM,
      effects: [],
      direction: DEFAULT_DIRECTION,
      ...(transitionOut ? { transitionOut } : {}),
      reason: { segmentId: `nar_${id}`, semanticScore: 0.5, finalScore: 0.5 },
    };
  }

  const hard: TimelineTransitionOut = { style: 'hard', durationMs: 0, requested: 'hard' };
  const xfade: TimelineTransitionOut = {
    style: 'crossfade',
    durationMs: 300,
    requested: 'crossfade',
  };

  async function render(name: string, outs: (TimelineTransitionOut | undefined)[]): Promise<void> {
    const clips = outs.map((t, i) =>
      clip(`clp_${i + 1}`, i, i === outs.length - 1 ? undefined : t),
    );
    const durationMs = clips.length * 2000;
    const tl = Timeline.parse({
      projectId: 'prj_f04',
      durationMs,
      audio: { path: audioPath(), timelineStartMs: 0, sourceStartMs: 0 },
      clips,
    });
    const assets: ResolvedAssets = {
      audioPath: audioPath(),
      audioDurationMs: 12_000,
      clips: clips.map((c, i) => ({ clipId: c.id, videoPath: videoPath(i + 1) })),
    };
    const graph = buildFfmpegGraph(tl, assets);
    const outPath = join(dir, `${name}.mp4`);
    // Exit code 0 or the promise rejects.
    await run('ffmpeg', toFfmpegArgs(graph, outPath), { maxBuffer: 32 * 1024 * 1024 });

    const probe = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,duration',
      '-of',
      'json',
      outPath,
    ]);
    const parsed = JSON.parse(probe.stdout) as {
      format: { duration: string };
      streams: { codec_type: string; duration?: string }[];
    };
    const expectedS = durationMs / 1000;
    expect(Math.abs(Number(parsed.format.duration) - expectedS)).toBeLessThan(0.25);
    const video = parsed.streams.find((s) => s.codec_type === 'video');
    const audio = parsed.streams.find((s) => s.codec_type === 'audio');
    expect(video).toBeDefined();
    expect(audio).toBeDefined();
    if (video?.duration) {
      expect(Math.abs(Number(video.duration) - expectedS)).toBeLessThan(0.25);
    }
  }

  it('renders hard -> crossfade', async () => {
    await render('hard_xfade', [hard, xfade, undefined]);
  }, 60_000);

  it('renders crossfade -> hard', async () => {
    await render('xfade_hard', [xfade, hard, undefined]);
  }, 60_000);

  it('renders crossfade -> crossfade', async () => {
    await render('xfade_xfade', [xfade, xfade, undefined]);
  }, 60_000);

  it('renders a five-clip hard/crossfade alternation', async () => {
    await render('alt5', [hard, xfade, hard, xfade, undefined]);
  }, 90_000);

  it('keeps the video stream as long as the audio when clips have fractional frame lengths (F07)', async () => {
    // Ten 433 ms clips = 12.99 frames each at 30 fps. Trimming each by seconds
    // keeps 12 whole frames, so the concatenated video used to come out ~330 ms
    // short of the 4330 ms audio and fail output validation.
    const slotMs = 433;
    const clips: TimelineClip[] = Array.from({ length: 10 }, (_, i) => ({
      id: `clp_${i + 1}`,
      momentId: `mom_${i + 1}`,
      timeline: { startMs: i * slotMs, endMs: (i + 1) * slotMs },
      source: { assetId: `ast_${i}`, startMs: 1000, endMs: 1000 + slotMs },
      transform: DEFAULT_TRANSFORM,
      effects: [],
      direction: DEFAULT_DIRECTION,
      reason: { segmentId: `nar_${i + 1}`, semanticScore: 0.5, finalScore: 0.5 },
    }));
    const durationMs = 10 * slotMs;
    const tl = Timeline.parse({
      projectId: 'prj_f07',
      durationMs,
      audio: { path: audioPath(), timelineStartMs: 0, sourceStartMs: 0 },
      clips,
    });
    const assets: ResolvedAssets = {
      audioPath: audioPath(),
      audioDurationMs: 12_000,
      clips: clips.map((c, i) => ({ clipId: c.id, videoPath: videoPath((i % 5) + 1) })),
    };
    const outPath = join(dir, 'fractional.mp4');
    await run('ffmpeg', toFfmpegArgs(buildFfmpegGraph(tl, assets), outPath), {
      maxBuffer: 32 * 1024 * 1024,
    });
    const probe = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=duration,nb_read_frames',
      '-of',
      'json',
      outPath,
    ]);
    const stream = (
      JSON.parse(probe.stdout) as { streams: { duration: string; nb_read_frames: string }[] }
    ).streams[0];
    expect(Number(stream?.nb_read_frames)).toBe(Math.round((durationMs * 30) / 1000));
    expect(Math.abs(Number(stream?.duration) * 1000 - durationMs)).toBeLessThanOrEqual(34);
  }, 90_000);
});
