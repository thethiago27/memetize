/**
 * Shared thresholds for the Effects Planner (spec sections 33, 57). Kept as
 * named constants — not magic numbers — so `planEffects` and its tests all
 * agree on the same punchline zoom window.
 */

/** Same punchline proxy as the Timing Optimizer (phase 8). */
export const PUNCHLINE_FUNCTIONS: ReadonlySet<string> = new Set(['payoff', 'punchline', 'climax']);

/** Canonical spec §34 example window: 1850 - 1200. */
export const ZOOM_TAIL_MS = 650;
export const ZOOM_TAIL_FRACTION = 1 / 3;
/** Same floor as `MIN_CLIP_MS` in `@memetize/renderer`. */
export const MIN_ZOOM_MS = 300;
export const ZOOM_FROM = 1;
export const ZOOM_TO = 1.12;
export const ZOOM_TO_HIGH = 1.18;
export const HIGH_ENERGY = 0.7;
