import { existsSync } from 'node:fs';
import { GlobalFonts } from '@napi-rs/canvas';
import { FONT_FAMILY, INTER_BOLD_PATH } from './constants';

let fontRegistered = false;

/** Registers the bundled Inter Bold once; layout and rasterization both call this. */
export function ensureFont(): void {
  if (fontRegistered) return;
  if (!existsSync(INTER_BOLD_PATH)) {
    throw new Error(`SUBTITLES_FONT_MISSING:${INTER_BOLD_PATH}`);
  }
  GlobalFonts.registerFromPath(INTER_BOLD_PATH, FONT_FAMILY);
  fontRegistered = true;
}
