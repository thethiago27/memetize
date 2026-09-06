/**
 * Shared thresholds for the Timing Optimizer (spec section 32). Kept as
 * named constants — not magic numbers — so `optimizeTiming` and its tests
 * all agree on the same snap windows.
 */
export const MIN_TIMED_CLIP_MS = 1_000;
export const SNAP_WINDOW_MS = 150;
export const PUNCHLINE_SNAP_WINDOW_MS = 250;

/** How close a downbeat timestamp must be to an existing beat to be merged
 * into it instead of inserted as its own point. */
export const DOWNBEAT_MERGE_TOLERANCE_MS = 10;

/** Downbeats are structurally important by definition, even when they have
 * no matching entry (and therefore no measured onset strength) in `beats`. */
export const DOWNBEAT_STRENGTH = 1;

/** The punchline proxy lives in `@memetize/contracts`; both planners share it. */
export { isPunchlineFunction, PUNCHLINE_FUNCTIONS } from '@memetize/contracts';
