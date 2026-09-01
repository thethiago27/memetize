export const MAX_OUTPUT_DURATION_MS = 60_000;
export const MIN_VISUAL_SLOT_MS = 1_000;
export const MAX_VISUAL_SLOT_MS = 4_000;
export const HIGHLIGHT_SELECTOR = 'structural-highlight';
export const HIGHLIGHT_SELECTOR_VERSION = '1.0.0';
export const HIGHLIGHT_WEIGHTS = {
  section: 0.3,
  energy: 0.2,
  lyrics: 0.15,
  narrativeArc: 0.15,
  boundaries: 0.2,
} as const;
