import { WORKER_VERSION } from '@memetize/contracts';

/**
 * Shared thresholds for the Renderer (spec sections 38-39). Kept as named
 * constants — not magic numbers — so `validateTimeline`, `validateOutput`
 * and their tests all agree on the same cutoffs.
 */
export const MIN_CLIP_MS = 300;
export const AUDIO_FADE_IN_MS = 120;
export const AUDIO_FADE_OUT_MS = 250;
export const DURATION_DRIFT_MS = 100;
/**
 * Audio streams carry encoder priming/padding, so a rendered audio stream is
 * allowed to drift more than the video before it counts as a truncated stream.
 */
export const AUDIO_DRIFT_MS = 300;
/**
 * A video stream may end before the audio without failing the render: the
 * frame-grid cut keeps clips exact, but source files that end before the
 * moment the catalog recorded still lose frames, and a slightly early video
 * end is acceptable output. Below this fraction of the timeline the video is
 * considered truncated and the render is rejected.
 *
 * The floor was 0.8, which let a video a fifth shorter than its audio — 48 s
 * under a 60 s track — publish as valid with only a warning (F07). Real
 * shortfalls observed in renders are around 2%, so that is the tolerance.
 */
export const VIDEO_MIN_COVERAGE = 0.98;
export const RENDERER_NAME = 'ffmpeg';

/**
 * The renderer's version, taken from the job registry rather than declared
 * again here. Job identity is `jobType+entityId+inputHash+workerVersion` (spec
 * section 4.2), so the two must be the same string: while they were separate,
 * burning subtitles into the output bumped this to 1.1.0 while
 * `WORKER_VERSION.RENDER` still said 1.0.0, which made a pre-subtitles render
 * look reusable for a timeline that now carries captions.
 */
export const RENDERER_VERSION = WORKER_VERSION.RENDER;

/** Codecs the renderer always produces; anything else means the encode is not ours. */
export const OUTPUT_VIDEO_CODEC = 'h264';
export const OUTPUT_AUDIO_CODEC = 'aac';

/** The transition cap lives with the timeline schema; re-exported for callers here. */
export { MAX_TRANSITION_SLOT_FRACTION } from '@memetize/timeline';

/** `xfade=transition=` names for the overlapping styles. */
export const XFADE_TRANSITION_BY_STYLE = {
  crossfade: 'fade',
  whip: 'slideleft',
} as const;

export const FADE_COLOR_BY_STYLE = {
  dip_black: 'black',
  flash: 'white',
} as const;
