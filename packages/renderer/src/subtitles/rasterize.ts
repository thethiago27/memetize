import { createCanvas } from '@napi-rs/canvas';
import {
  FILL_COLOR,
  FONT_FAMILY,
  LINE_HEIGHT,
  OUTLINE_COLOR,
  SHADOW_BLUR,
  SHADOW_COLOR,
  SHADOW_OFFSET_X,
  SHADOW_OFFSET_Y,
} from './constants';
import { ensureFont } from './font';
import type { CueLayout } from './layout';

/**
 * Draws the laid-out lines on a transparent PNG: outline first, then fill,
 * with a soft drop shadow (translated-subtitles spec).
 */
export function rasterizeCue(layout: CueLayout): Buffer {
  ensureFont();
  const canvas = createCanvas(Math.max(1, layout.width), Math.max(1, layout.height));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.font = `bold ${layout.fontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = layout.outlineWidth * 2;

  const lineHeightPx = Math.round(layout.fontSize * LINE_HEIGHT);
  const blockHeight = lineHeightPx * layout.lines.length;
  const firstCenterY = (layout.height - blockHeight) / 2 + lineHeightPx / 2;
  const centerX = layout.width / 2;

  ctx.shadowColor = SHADOW_COLOR;
  ctx.shadowOffsetX = SHADOW_OFFSET_X;
  ctx.shadowOffsetY = SHADOW_OFFSET_Y;
  ctx.shadowBlur = SHADOW_BLUR;

  layout.lines.forEach((line, index) => {
    const y = firstCenterY + index * lineHeightPx;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.strokeText(line, centerX, y);
    ctx.fillStyle = FILL_COLOR;
    ctx.fillText(line, centerX, y);
  });

  return canvas.toBuffer('image/png');
}
