/**
 * Longest output the pipeline produces. Chosen as a middle ground: long enough
 * for a musical hook, short enough that the catalog covers it with strong
 * clips and the render stays fast.
 */
export const MAX_OUTPUT_DURATION_MS = 30_000;
export const MIN_VISUAL_SLOT_MS = 1_000;
export const MAX_VISUAL_SLOT_MS = 4_000;
/**
 * Source margin coverage keeps on each side of a clip's take, within the
 * moment, so an overlapping transition (crossfade/whip) has the `D/2` handle it
 * needs later in Effects (F05). Sized to the crossfade's maximum handle
 * (crossfade clamp max 500ms / 2); coverage reserves as much of it as the
 * moment's spare room allows and none when the moment is exactly slot-sized.
 */
export const TRANSITION_HANDLE_RESERVE_MS = 250;
/**
 * How close a window edge must be to a section boundary or downbeat to count as
 * aligned, with a linear falloff inside it.
 *
 * The boundaries term used to require an exact match. A window's start is a
 * candidate taken from those very times so it could hit, but its end is
 * `start + MAX_OUTPUT_DURATION_MS` and so essentially never landed on one —
 * half the term was dead, and for a manually picked window both halves were.
 */
export const STRUCTURAL_ALIGNMENT_TOLERANCE_MS = 150;

/**
 * How far back the boundaries term looks to measure the energy step at a
 * window's start. It compared `t` with `t - 1ms`, and the energy curve is
 * sampled far more coarsely than that, so both lookups returned the same sample
 * and the smoothness half of the term was constant.
 */
export const BOUNDARY_ENERGY_LOOKBACK_MS = 1_000;

export const HIGHLIGHT_SELECTOR = 'structural-highlight';
/** 1.1.0: the boundaries term actually varies (alignment tolerance, real energy step). */
export const HIGHLIGHT_SELECTOR_VERSION = '1.1.0';
export const HIGHLIGHT_WEIGHTS = {
  section: 0.3,
  energy: 0.2,
  lyrics: 0.15,
  narrativeArc: 0.15,
  boundaries: 0.2,
} as const;
