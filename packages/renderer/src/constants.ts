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
export const RENDERER_NAME = 'ffmpeg';
export const RENDERER_VERSION = '1.0.0';

/**
 * Cut styles (cut-styles spec). A transition may never take more than this
 * fraction of the smaller neighboring slot; the Effects resolver plans
 * against the same number, and `validateTimeline` enforces it.
 */
export const MAX_TRANSITION_SLOT_FRACTION = 1 / 3;

/** `xfade=transition=` names for the overlapping styles. */
export const XFADE_TRANSITION_BY_STYLE = {
  crossfade: 'fade',
  whip: 'slideleft',
} as const;

export const FADE_COLOR_BY_STYLE = {
  dip_black: 'black',
  flash: 'white',
} as const;
