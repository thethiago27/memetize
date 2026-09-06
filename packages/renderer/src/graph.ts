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
  clipTimeModel,
  isOverlapStyle,
  toSeconds,
  transitionOutOf,
  xfadeTransitionName,
} from './cuts';
import { BASELINE_RATIO } from './subtitles/constants';
import type { FfmpegGraph, FfmpegInput, RenderedCue, ResolvedAssets } from './types';
import { buildZoomFilter, parseZoomEffect } from './zoom';

/** One clip rendered as a labelled segment, with the output ms and frames it lasts. */
interface Segment {
  label: string;
  lengthMs: number;
  /** Exact output frame count the segment is cut to; sums to the timeline's total. */
  frames: number;
}

/**
 * Frames cloned at the end of every segment before it is cut to its exact
 * frame count. A `trim` by seconds keeps whole frames only, so each clip can
 * come out up to one frame short of its slot; over a 29-clip minute that adds
 * up to several missing frames and a video stream shorter than the audio (F07).
 * Cloning a couple of frames and cutting at `end_frame` makes every segment
 * exactly as long as its slot on the frame grid — at most one duplicated frame
 * at a cut, never a visible freeze.
 */
const FRAME_PAD = 3;

/** The frame-grid position of a timeline instant. */
function frameAt(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}

/** Seconds with enough precision to name a frame boundary exactly. */
function framesToSeconds(frames: number, fps: number): string {
  return (frames / fps).toFixed(6);
}

interface TransitionFrames {
  /** Whole frames the overlap lasts; head + tail. */
  durationFrames: number;
  /** Frames the incoming (right) clip extends before its slot. */
  headFrames: number;
  /** Frames the outgoing (left) clip extends past its slot. */
  tailFrames: number;
}

function transitionFrames(transition: TimelineTransitionOut, fps: number): TransitionFrames {
  if (!isOverlapStyle(transition.style)) return { durationFrames: 0, headFrames: 0, tailFrames: 0 };
  const durationFrames = frameAt(transition.durationMs, fps);
  const headFrames = Math.floor(durationFrames / 2);
  return { durationFrames, headFrames, tailFrames: durationFrames - headFrames };
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
export function buildFfmpegGraph(
  timeline: Timeline,
  assets: ResolvedAssets,
  options?: { subtitles?: RenderedCue[] },
): FfmpegGraph {
  const { fps } = timeline.canvas;
  const videoPathByClipId = new Map(assets.clips.map((clip) => [clip.clipId, clip.videoPath]));
  const clips = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);

  if (clips.length === 0) {
    throw new Error('buildFfmpegGraph: empty timeline');
  }

  const transitions = clips.map((clip, index) => transitionOutOf(clip, index === clips.length - 1));
  const framesByTransition = transitions.map((transition) => transitionFrames(transition, fps));

  const inputs: FfmpegInput[] = [{ path: assets.audioPath, kind: 'audio' }];
  const filterParts: string[] = [];
  const segments: Segment[] = [];
  const joinedTransitions: TimelineTransitionOut[] = [];
  const joinedFrames: TransitionFrames[] = [];
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

    const slotMs = clip.timeline.endMs - clip.timeline.startMs;
    const sourceMs = clip.source.endMs - clip.source.startMs;
    if (sourceMs < slotMs) {
      throw new Error('buildFfmpegGraph: source shorter than slot');
    }
    cursorMs = clip.timeline.endMs;

    const incoming = index > 0 ? (transitions[index - 1] ?? null) : null;
    const outgoing = transitions[index] ?? { style: 'hard', durationMs: 0, requested: 'hard' };
    const incomingFrames = index > 0 ? framesByTransition[index - 1] : undefined;
    const outgoingFrames = framesByTransition[index];
    // Slot frames come from the timeline's frame grid, so the sum over all
    // clips telescopes to exactly `durationMs` worth of frames.
    const slotFrames = frameAt(clip.timeline.endMs, fps) - frameAt(clip.timeline.startMs, fps);
    const frames =
      slotFrames + (incomingFrames?.headFrames ?? 0) + (outgoingFrames?.tailFrames ?? 0);
    if (frames <= 0) {
      // A clip that occupies no frame of the output grid cannot be rendered:
      // silently dropping it used to desynchronize the join, because the
      // previous clip had already extended into a transition this clip was
      // supposed to complete. `validateTimeline` rejects these before any
      // spawn, so reaching here means the graph was built without validating.
      throw new Error(`buildFfmpegGraph: clip "${clip.id}" occupies no output frame`);
    }

    const inputIndex = inputs.length;
    inputs.push({ path: videoPath, kind: 'video' });
    const segment = buildSegment({
      clip,
      inputIndex,
      incoming,
      outgoing,
      canvas: timeline.canvas,
      frames,
    });
    filterParts.push(`${segment.chain}[v${segments.length}]`);
    segments.push({ label: `[v${segments.length}]`, lengthMs: segment.lengthMs, frames });
    joinedTransitions.push(outgoing);
    joinedFrames.push(outgoingFrames ?? { durationFrames: 0, headFrames: 0, tailFrames: 0 });
  });

  if (timeline.durationMs - cursorMs > 0) {
    throw new Error('buildFfmpegGraph: timeline gap');
  }

  const cues = options?.subtitles ?? [];
  const joinLabel = cues.length > 0 ? '[vjoin]' : '[vout]';
  filterParts.push(...joinSegments(segments, joinedTransitions, joinedFrames, fps, joinLabel));
  if (cues.length > 0) {
    filterParts.push(...buildSubtitleOverlays(cues, timeline.canvas.height, inputs));
  }
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
  /** Exact output frame count this segment is cut to. */
  frames: number;
}): { chain: string; lengthMs: number } {
  const { clip, canvas } = params;
  // One time model, shared with `validateTimeline`, so what the graph consumes
  // and what the validator checks can never drift apart.
  const { headMs, tailMs, lengthMs, factor, holdMs, trimStartMs, trimEndMs } = clipTimeModel(
    clip,
    params.incoming,
    params.outgoing,
  );

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

  if (holdMs > 0) filters.push(buildHoldFilter(holdMs, tailMs));
  filters.push(
    ...buildBoundaryFadeFilters({
      incoming: params.incoming,
      outgoing: params.outgoing,
      segmentMs: lengthMs,
    }),
  );
  // Put the segment on the output frame grid and cut it to exactly `frames`
  // frames: `fps` resamples, the clone pad guarantees enough frames exist, the
  // frame trim removes any surplus (F07). Pinning the time base as well means
  // every operand of an xfade shares 1/fps; xfade rejects mismatched time bases (F04).
  filters.push(
    `fps=${canvas.fps}`,
    `tpad=stop_mode=clone:stop=${FRAME_PAD}`,
    `trim=end_frame=${params.frames}`,
    'setpts=PTS-STARTPTS',
    `settb=1/${canvas.fps}`,
    'setsar=1',
  );

  return { chain: `[${params.inputIndex}:v]${filters.join(',')}`, lengthMs };
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
  transitionFrames: readonly TransitionFrames[],
  fps: number,
  outputLabel = '[vout]',
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
    state.acc = {
      label,
      lengthMs: parts.reduce((sum, part) => sum + part.lengthMs, 0),
      frames: parts.reduce((sum, part) => sum + part.frames, 0),
    };
  };

  segments.forEach((segment, index) => {
    const incoming = index > 0 ? transitions[index - 1] : undefined;
    const incomingFrames = index > 0 ? transitionFrames[index - 1] : undefined;
    if (incoming && incomingFrames && isOverlapStyle(incoming.style)) {
      flushRun();
      const left = state.acc;
      if (!left) throw new Error('buildFfmpegGraph: xfade with nothing on the left');
      // The transition occupies the last D of the accumulated video: it starts
      // D/2 before the slot boundary, which sits D/2 before the end. Both are
      // expressed in whole frames so the joined length stays on the grid.
      const { durationFrames } = incomingFrames;
      const offsetFrames = left.frames - durationFrames;
      const label = nextLabel();
      ops.push({
        inputs: `${left.label}${segment.label}`,
        filter: `xfade=transition=${xfadeTransitionName(incoming.style)}:duration=${framesToSeconds(durationFrames, fps)}:offset=${framesToSeconds(offsetFrames, fps)}`,
      });
      state.acc = {
        label,
        lengthMs: left.lengthMs + segment.lengthMs - incoming.durationMs,
        frames: left.frames + segment.frames - durationFrames,
      };
      return;
    }
    state.run.push(segment);
  });
  flushRun();

  if (ops.length === 0) {
    // A single clip with nothing to join still has to produce the output label.
    return [`${state.acc?.label ?? ''}concat=n=1:v=1:a=0${outputLabel}`];
  }

  return ops.map((op, index) => {
    const out = index === ops.length - 1 ? outputLabel : `[acc${index + 1}]`;
    return `${op.inputs}${op.filter}${out}`;
  });
}

/**
 * Composites each caption PNG over the joined video for its window.
 *
 * The window is half-open — `gte(t,start)*lt(t,end)` rather than
 * `between(t,start,end)`. `between` is inclusive at both ends and cues are
 * contiguous, so at the exact instant one cue ended and the next began both
 * overlays were enabled and the captions stacked for one frame.
 */
function buildSubtitleOverlays(
  cues: readonly RenderedCue[],
  canvasHeight: number,
  inputs: FfmpegInput[],
): string[] {
  const ops: string[] = [];
  cues.forEach((cue, index) => {
    const inputIndex = inputs.length;
    inputs.push({ path: cue.pngPath, kind: 'image' });
    const y = Math.round(canvasHeight * BASELINE_RATIO - cue.height);
    const prev = index === 0 ? '[vjoin]' : `[vs${index - 1}]`;
    const next = index === cues.length - 1 ? '[vout]' : `[vs${index}]`;
    const enable = `gte(t,${toSeconds(cue.startMs)})*lt(t,${toSeconds(cue.endMs)})`;
    ops.push(`${prev}[${inputIndex}:v]overlay=x=(W-w)/2:y=${y}:enable='${enable}'${next}`);
  });
  return ops;
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
