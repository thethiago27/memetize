import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bundled Inter Bold (SIL OFL 1.1) used for burned-in captions. */
export const INTER_BOLD_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../assets/fonts/Inter-Bold.ttf',
);

export const FONT_FAMILY = 'Inter';
/** Base font size as a fraction of canvas height (48 px at 1080×1920). */
export const FONT_SIZE_RATIO = 0.025;
export const MAX_WIDTH_RATIO = 0.84;
/** Bottom edge of the caption block as a fraction of canvas height. */
export const BASELINE_RATIO = 0.78;
export const LINE_HEIGHT = 1.2;
export const OUTLINE_RATIO = 0.08;
export const MAX_LINES = 3;
export const MIN_FONT_SCALE = 0.6;

export const FILL_COLOR = '#ffffff';
export const OUTLINE_COLOR = '#000000';
export const SHADOW_COLOR = 'rgba(0, 0, 0, 0.45)';
export const SHADOW_OFFSET_X = 0;
export const SHADOW_OFFSET_Y = 2;
export const SHADOW_BLUR = 6;
