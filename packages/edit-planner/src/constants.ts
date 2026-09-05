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
export const HIGHLIGHT_SELECTOR = 'structural-highlight';
export const HIGHLIGHT_SELECTOR_VERSION = '1.0.0';
export const HIGHLIGHT_WEIGHTS = {
  section: 0.3,
  energy: 0.2,
  lyrics: 0.15,
  narrativeArc: 0.15,
  boundaries: 0.2,
} as const;
