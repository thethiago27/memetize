/**
 * Shared thresholds for the Effects Planner (spec sections 33, 57). Kept as
 * named constants — not magic numbers — so `planEffects` and its tests all
 * agree on the same punchline zoom window.
 */

/** The punchline proxy lives in `@memetize/contracts`; both planners share it. */
export { isPunchlineFunction, PUNCHLINE_FUNCTIONS } from '@memetize/contracts';

/** Canonical spec §34 example window: 1850 - 1200. */
export const ZOOM_TAIL_MS = 650;
export const ZOOM_TAIL_FRACTION = 1 / 3;
/** Same floor as `MIN_CLIP_MS` in `@memetize/renderer`. */
export const MIN_ZOOM_MS = 300;
export const ZOOM_FROM = 1;
export const ZOOM_TO = 1.12;
export const ZOOM_TO_HIGH = 1.18;
export const HIGH_ENERGY = 0.7;

/**
 * Cut styles (cut-styles spec): every transition and hold duration comes
 * from the song's tempo, never from the model. Clamps are even so the
 * `D/2` source handle on each side of a boundary is always integer ms.
 */
export const DEFAULT_BEAT_MS = 500;

export const TRANSITION_BEAT_FRACTION = {
  crossfade: 1,
  whip: 0.5,
  dip_black: 0.5,
  flash: 0.25,
} as const;

export const TRANSITION_CLAMP_MS = {
  crossfade: { min: 200, max: 500 },
  whip: { min: 120, max: 250 },
  dip_black: { min: 150, max: 400 },
  flash: { min: 80, max: 160 },
} as const;

/** The cap on a transition versus the smaller neighboring slot (timeline time model). */
export { MAX_TRANSITION_SLOT_FRACTION } from '@memetize/timeline';

export const HOLD_BEAT_FRACTION = 1;
export const HOLD_CLAMP_MS = { min: 200, max: 600 } as const;
/** Motion that must remain in front of a hold; the same floor as `MIN_ZOOM_MS`. */
export const MIN_MOTION_BEFORE_HOLD_MS = MIN_ZOOM_MS;

export const SPEED_UP_FACTOR = 1.25;
export const SLOW_DOWN_FACTOR = 0.8;
