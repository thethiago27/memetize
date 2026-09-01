import type { Timeline, TimelineCanvas, TimelineTransform } from '@memetize/timeline';
import { AUDIO_FADE_IN_MS, AUDIO_FADE_OUT_MS } from './constants';
import type { FfmpegGraph, FfmpegInput, ResolvedAssets } from './types';
import { buildZoomFilter, parseZoomEffect } from './zoom';

/**
 * Builds the single `-filter_complex` graph for a fully covered `Timeline`.
 * Gaps, empty clips, and source-short slots throw instead of inserting
 * black or clone-pad fallbacks. Audio is trimmed and timestamp-rebased.
 */
export function buildFfmpegGraph(timeline: Timeline, assets: ResolvedAssets): FfmpegGraph {
  const { fps } = timeline.canvas;
  const videoPathByClipId = new Map(assets.clips.map((clip) => [clip.clipId, clip.videoPath]));
  const clips = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);

  if (clips.length === 0) {
    throw new Error('buildFfmpegGraph: empty timeline');
  }

  const inputs: FfmpegInput[] = [{ path: assets.audioPath, kind: 'audio' }];
  const filterParts: string[] = [];
  const segmentLabels: string[] = [];
  let cursorMs = 0;

  clips.forEach((clip, index) => {
    const gapMs = clip.timeline.startMs - cursorMs;
    if (gapMs > 0) {
      throw new Error('buildFfmpegGraph: timeline gap');
    }

    const videoPath = videoPathByClipId.get(clip.id);
    if (!videoPath) {
      throw new Error(`buildFfmpegGraph: no resolved asset for clip "${clip.id}"`);
    }
    const inputIndex = inputs.length;
    inputs.push({ path: videoPath, kind: 'video' });

    const slotMs = clip.timeline.endMs - clip.timeline.startMs;
    const sourceMs = clip.source.endMs - clip.source.startMs;
    if (sourceMs < slotMs) {
      throw new Error('buildFfmpegGraph: source shorter than slot');
    }

    const transformFilter = buildTransformFilter(clip.transform, timeline.canvas);

    let chain =
      `[${inputIndex}:v]trim=start=${toSeconds(clip.source.startMs)}:end=${toSeconds(clip.source.endMs)},` +
      `setpts=PTS-STARTPTS,${transformFilter}`;
    const zooms = clip.effects
      .map((effect) => parseZoomEffect(effect, clip))
      .filter((zoom): zoom is NonNullable<typeof zoom> => zoom !== null)
      .sort((a, b) => a.startMs - b.startMs);
    for (const zoom of zooms) {
      chain += `,${buildZoomFilter(zoom, clip, timeline.canvas)}`;
    }
    chain += ',setsar=1';
    const label = `v${index}`;
    filterParts.push(`${chain}[${label}]`);
    segmentLabels.push(`[${label}]`);

    cursorMs = clip.timeline.endMs;
  });

  if (timeline.durationMs - cursorMs > 0) {
    throw new Error('buildFfmpegGraph: timeline gap');
  }

  filterParts.push(`${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=1:a=0[vout]`);
  filterParts.push(buildAudioFilter(timeline, assets));

  const outputArgs = [
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-t',
    toSeconds(timeline.durationMs),
  ];

  return {
    inputs,
    filterComplex: filterParts.join(';'),
    outputArgs,
    durationMs: timeline.durationMs,
  };
}

/**
 * `toFfmpegArgs` always prefixes the quiet flags and ends with the output
 * path so the worker only has to append this array to `execFile('ffmpeg', ...)`.
 */
export function toFfmpegArgs(graph: FfmpegGraph, outputPath: string): string[] {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const input of graph.inputs) {
    args.push('-i', input.path);
  }
  args.push('-filter_complex', graph.filterComplex, ...graph.outputArgs, outputPath);
  return args;
}

function buildAudioFilter(timeline: Timeline, assets: ResolvedAssets): string {
  const sourceStartMs = timeline.audio.sourceStartMs;
  const durationMs = timeline.durationMs;
  const parts = [
    `atrim=start=${toSeconds(sourceStartMs)}:duration=${toSeconds(durationMs)}`,
    'asetpts=PTS-STARTPTS',
  ];

  const halfDurationMs = Math.floor(durationMs / 2);
  if (sourceStartMs > 0) {
    const fadeInMs = Math.min(AUDIO_FADE_IN_MS, halfDurationMs);
    if (fadeInMs > 0) {
      parts.push(`afade=t=in:st=0:d=${toSeconds(fadeInMs)}`);
    }
  }
  if (sourceStartMs + durationMs < assets.audioDurationMs) {
    const fadeOutMs = Math.min(AUDIO_FADE_OUT_MS, halfDurationMs);
    if (fadeOutMs > 0) {
      parts.push(`afade=t=out:st=${toSeconds(durationMs - fadeOutMs)}:d=${toSeconds(fadeOutMs)}`);
    }
  }
  parts.push(`volume=${timeline.audio.volume}`);
  return `[0:a]${parts.join(',')}[aout]`;
}

function toSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * `cover` crops to fill the canvas, `contain` letterboxes in black.
 * `transform.scale` zooms in/out before the crop/pad and
 * `positionX`/`positionY` (0-1) choose where the extra pixels get cut or
 * padded, so a centered default (`0.5, 0.5, cover`) exactly fills the
 * canvas with no visible transform.
 */
function buildTransformFilter(transform: TimelineTransform, canvas: TimelineCanvas): string {
  const { width, height } = canvas;
  const scaledW = Math.round(width * transform.scale);
  const scaledH = Math.round(height * transform.scale);

  if (transform.cropMode === 'contain') {
    return (
      `scale=w=${scaledW}:h=${scaledH}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:x=(ow-iw)*${transform.positionX}:y=(oh-ih)*${transform.positionY}:color=black`
    );
  }

  return (
    `scale=w=${scaledW}:h=${scaledH}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height}:x=(iw-${width})*${transform.positionX}:y=(ih-${height})*${transform.positionY}`
  );
}
