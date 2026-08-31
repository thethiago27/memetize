import type { Timeline, TimelineCanvas, TimelineTransform } from '@memetize/timeline';
import type { FfmpegGraph, FfmpegInput, ResolvedAssets } from './types';
import { buildZoomFilter, parseZoomEffect } from './zoom';

/**
 * Builds the single `-filter_complex` graph for a `Timeline` (spec section
 * 37): hard cuts, black segments over every gap, and a per-clip
 * scale/crop/pad chain. Every concat segment is pinned to SAR 1:1 —
 * `scale`+`crop` of a 16:9 proxy otherwise drifts (e.g. 10240:10239)
 * and FFmpeg refuses to concat it with `color=` gaps. No file is
 * touched here — this is pure string assembly so it's cheap to unit
 * test without spawning FFmpeg.
 */
export function buildFfmpegGraph(timeline: Timeline, assets: ResolvedAssets): FfmpegGraph {
  const { width, height, fps } = timeline.canvas;
  const videoPathByClipId = new Map(assets.clips.map((clip) => [clip.clipId, clip.videoPath]));
  const clips = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);

  const inputs: FfmpegInput[] = [{ path: assets.audioPath, kind: 'audio' }];
  const filterParts: string[] = [];
  const segmentLabels: string[] = [];
  let gapCount = 0;
  let cursorMs = 0;

  const pushGap = (gapMs: number): void => {
    if (gapMs <= 0) return;
    const label = `gap${gapCount++}`;
    filterParts.push(
      `color=c=black:s=${width}x${height}:r=${fps}:d=${toSeconds(gapMs)}:sar=1[${label}]`,
    );
    segmentLabels.push(`[${label}]`);
  };

  clips.forEach((clip, index) => {
    pushGap(clip.timeline.startMs - cursorMs);

    const videoPath = videoPathByClipId.get(clip.id);
    if (!videoPath) {
      throw new Error(`buildFfmpegGraph: no resolved asset for clip "${clip.id}"`);
    }
    const inputIndex = inputs.length;
    inputs.push({ path: videoPath, kind: 'video' });

    const slotMs = clip.timeline.endMs - clip.timeline.startMs;
    const sourceMs = clip.source.endMs - clip.source.startMs;
    const transformFilter = buildTransformFilter(clip.transform, timeline.canvas);

    let chain =
      `[${inputIndex}:v]trim=start=${toSeconds(clip.source.startMs)}:end=${toSeconds(clip.source.endMs)},` +
      `setpts=PTS-STARTPTS,${transformFilter}`;
    if (sourceMs < slotMs) {
      chain += `,tpad=stop_mode=clone:stop_duration=${toSeconds(slotMs - sourceMs)}`;
    }
    const zooms = clip.effects
      .map((effect) => parseZoomEffect(effect, clip))
      .filter((zoom): zoom is NonNullable<typeof zoom> => zoom !== null)
      .sort((a, b) => a.startMs - b.startMs);
    for (const zoom of zooms) {
      chain += `,${buildZoomFilter(zoom, clip, timeline.canvas)}`;
    }
    // concat rejects mixed SAR; scale+crop of a 16:9 proxy yields 10240:10239
    // while color= gaps stay 1:1.
    chain += ',setsar=1';
    const label = `v${index}`;
    filterParts.push(`${chain}[${label}]`);
    segmentLabels.push(`[${label}]`);

    cursorMs = clip.timeline.endMs;
  });

  pushGap(timeline.durationMs - cursorMs);

  filterParts.push(`${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=1:a=0[vout]`);
  filterParts.push(
    `[0:a]atrim=start=${toSeconds(timeline.audio.sourceStartMs)}:duration=${toSeconds(timeline.durationMs)},` +
      `volume=${timeline.audio.volume}[aout]`,
  );

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
 * path (spec section 37) so the worker only has to append this array to
 * `execFile('ffmpeg', ...)`.
 */
export function toFfmpegArgs(graph: FfmpegGraph, outputPath: string): string[] {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const input of graph.inputs) {
    args.push('-i', input.path);
  }
  args.push('-filter_complex', graph.filterComplex, ...graph.outputArgs, outputPath);
  return args;
}

function toSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * `cover` crops to fill the canvas, `contain` letterboxes in black (spec
 * section 37). `transform.scale` zooms in/out before the crop/pad and
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
