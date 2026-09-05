import type {
  Timeline,
  TimelineCanvas,
  TimelineClip,
  TimelineTransform,
  TimelineTransitionOut,
} from '@memetize/timeline';
import { AUDIO_FADE_IN_MS, AUDIO_FADE_OUT_MS } from './constants';
import {
  buildBoundaryFadeFilters,
  buildHoldFilter,
  buildSpeedFilter,
  handlesFor,
  isOverlapStyle,
  parseHoldEffect,
  parseSpeedEffect,
  toSeconds,
  transitionOutOf,
  xfadeTransitionName,
} from './cuts';
import type { FfmpegGraph, FfmpegInput, ResolvedAssets } from './types';
import { buildZoomFilter, parseZoomEffect } from './zoom';

/** One clip rendered as a labelled segment, with the output ms it lasts. */
interface Segment {
  label: string;
  lengthMs: number;
}

/**
 * Builds the single `-filter_complex` graph for a fully covered `Timeline`.
 * Gaps, empty clips, and source-short slots throw instead of inserting
 * black or clone-pad fallbacks. Audio is trimmed and timestamp-rebased.
 *
 * Cut styles (cut-styles spec): each clip becomes one segment that already
 * carries its speed change, zoom, frozen tail, fades, and the `D/2` source
 * handles an overlapping transition needs. Segments are then joined left
 * to right — runs of hard cuts and fades with `concat`, crossfades and
 * whips with `xfade` at `offset = accumulated − D` — so the output is
 * exactly `durationMs` long.
 */
export function buildFfmpegGraph(timeline: Timeline, assets: ResolvedAssets): FfmpegGraph {
  const { fps } = timeline.canvas;
  const videoPathByClipId = new Map(assets.clips.map((clip) => [clip.clipId, clip.videoPath]));
  const clips = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);

  if (clips.length === 0) {
    throw new Error('buildFfmpegGraph: empty timeline');
  }

  const transitions = clips.map((clip, index) => transitionOutOf(clip, index === clips.length - 1));
  const usesXfade = transitions.some((transition) => isOverlapStyle(transition.style));

  const inputs: FfmpegInput[] = [{ path: assets.audioPath, kind: 'audio' }];
  const filterParts: string[] = [];
  const segments: Segment[] = [];
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

    const incoming = index > 0 ? (transitions[index - 1] ?? null) : null;
    const outgoing = transitions[index] ?? { style: 'hard', durationMs: 0, requested: 'hard' };
    const segment = buildSegment({
      clip,
      inputIndex,
      incoming,
      outgoing,
      canvas: timeline.canvas,
      pinFps: usesXfade,
    });
    filterParts.push(`${segment.chain}[v${index}]`);
    segments.push({ label: `[v${index}]`, lengthMs: segment.lengthMs });

    cursorMs = clip.timeline.endMs;
  });

  if (timeline.durationMs - cursorMs > 0) {
    throw new Error('buildFfmpegGraph: timeline gap');
  }

  filterParts.push(...joinSegments(segments, transitions, fps));
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
 * One clip's filter chain. In output time the segment lasts
 * `head + slot + tail` (the handles of its overlapping transitions); the
 * motion part is that minus a frozen tail, and the source consumed is the
 * motion part times the playback factor.
 */
function buildSegment(params: {
  clip: TimelineClip;
  inputIndex: number;
  incoming: TimelineTransitionOut | null;
  outgoing: TimelineTransitionOut;
  canvas: TimelineCanvas;
  pinFps: boolean;
}): { chain: string; lengthMs: number } {
  const { clip, canvas } = params;
  const slotMs = clip.timeline.endMs - clip.timeline.startMs;
  const { headMs, tailMs } = handlesFor(params.incoming, params.outgoing);
  const lengthMs = headMs + slotMs + tailMs;

  const speed = firstParsed(clip, parseSpeedEffect);
  const factor = speed?.factor ?? 1;
  const hold = firstParsed(clip, parseHoldEffect);
  const holdMs = hold ? hold.endMs - hold.startMs : 0;
  // A frozen tail covers the hold and any outgoing handle; nothing after it moves.
  const motionMs = hold ? headMs + slotMs - holdMs : lengthMs;

  const trimStartMs = clip.source.startMs - headMs * factor;
  const trimEndMs = trimStartMs + motionMs * factor;

  const filters: string[] = [
    `trim=start=${toSeconds(trimStartMs)}:end=${toSeconds(trimEndMs)}`,
    'setpts=PTS-STARTPTS',
  ];
  const speedFilter = buildSpeedFilter(factor);
  if (speedFilter) filters.push(speedFilter);
  filters.push(buildTransformFilter(clip.transform, canvas));

  const zooms = clip.effects
    .map((effect) => parseZoomEffect(effect, clip))
    .filter((zoom): zoom is NonNullable<typeof zoom> => zoom !== null)
    .sort((a, b) => a.startMs - b.startMs);
  for (const zoom of zooms) {
    // `t` is zero at the segment start, which sits `headMs` before the slot.
    const shifted = { ...zoom, startMs: zoom.startMs + headMs, endMs: zoom.endMs + headMs };
    filters.push(buildZoomFilter(shifted, clip, canvas));
  }

  if (hold) filters.push(buildHoldFilter(holdMs, tailMs));
  filters.push(
    ...buildBoundaryFadeFilters({
      incoming: params.incoming,
      outgoing: params.outgoing,
      segmentMs: lengthMs,
    }),
  );
  // Pin both the frame rate and the time base so every operand of an xfade
  // shares 1/fps; xfade rejects mismatched time bases (F04).
  if (params.pinFps) filters.push(`fps=${canvas.fps}`, `settb=1/${canvas.fps}`);
  filters.push('setsar=1');

  return { chain: `[${params.inputIndex}:v]${filters.join(',')}`, lengthMs };
}

function firstParsed<T>(
  clip: TimelineClip,
  parse: (effect: TimelineClip['effects'][number], clip: TimelineClip) => T | null,
): T | null {
  for (const effect of clip.effects) {
    const parsed = parse(effect, clip);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * Joins segments left to right. Consecutive segments separated by hard
 * cuts or fades are concatenated in one `concat`; an overlapping
 * transition closes the pending run into the accumulator and `xfade`s
 * the next segment onto it. The final operation always writes `[vout]`.
 */
function joinSegments(
  segments: readonly Segment[],
  transitions: readonly TimelineTransitionOut[],
  fps: number,
): string[] {
  const ops: { inputs: string; filter: string }[] = [];
  const state: { acc: Segment | null; run: Segment[]; labels: number } = {
    acc: null,
    run: [],
    labels: 0,
  };
  const nextLabel = (): string => {
    state.labels += 1;
    return `[acc${state.labels}]`;
  };

  const flushRun = (): void => {
    if (state.run.length === 0) return;
    const parts = state.acc ? [state.acc, ...state.run] : state.run;
    state.run = [];
    const [only] = parts;
    if (parts.length === 1 && only) {
      // A lone segment needs no concat; it becomes the accumulator as is.
      state.acc = only;
      return;
    }
    const label = nextLabel();
    ops.push({
      inputs: parts.map((part) => part.label).join(''),
      // concat resets the time base (to 1/1000000); restore 1/fps so the
      // accumulator can feed a following xfade without a time-base mismatch (F04).
      filter: `concat=n=${parts.length}:v=1:a=0,fps=${fps},settb=1/${fps}`,
    });
    state.acc = { label, lengthMs: parts.reduce((sum, part) => sum + part.lengthMs, 0) };
  };

  segments.forEach((segment, index) => {
    const incoming = index > 0 ? transitions[index - 1] : undefined;
    if (incoming && isOverlapStyle(incoming.style)) {
      flushRun();
      const left = state.acc;
      if (!left) throw new Error('buildFfmpegGraph: xfade with nothing on the left');
      const durationMs = incoming.durationMs;
      // The transition occupies the last D ms of the accumulated video: it
      // starts D/2 before the slot boundary, which sits D/2 before the end.
      const offsetMs = left.lengthMs - durationMs;
      const label = nextLabel();
      ops.push({
        inputs: `${left.label}${segment.label}`,
        filter: `xfade=transition=${xfadeTransitionName(incoming.style)}:duration=${toSeconds(durationMs)}:offset=${toSeconds(offsetMs)}`,
      });
      state.acc = { label, lengthMs: left.lengthMs + segment.lengthMs - durationMs };
      return;
    }
    state.run.push(segment);
  });
  flushRun();

  if (ops.length === 0) {
    // A single clip with nothing to join still has to produce `[vout]`.
    return [`${state.acc?.label ?? ''}concat=n=1:v=1:a=0[vout]`];
  }

  return ops.map((op, index) => {
    const out = index === ops.length - 1 ? '[vout]' : `[acc${index + 1}]`;
    return `${op.inputs}${op.filter}${out}`;
  });
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
