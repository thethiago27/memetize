import type { TimelineCanvas } from '@memetize/timeline';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  FONT_FAMILY,
  FONT_SIZE_RATIO,
  LINE_HEIGHT,
  MAX_LINES,
  MAX_WIDTH_RATIO,
  MIN_FONT_SCALE,
  OUTLINE_RATIO,
  SHADOW_BLUR,
  SHADOW_OFFSET_X,
  SHADOW_OFFSET_Y,
} from './constants';
import { ensureFont } from './font';

export interface CueLayout {
  lines: string[];
  fontSize: number;
  width: number;
  height: number;
  outlineWidth: number;
  /** Transparent margin on every side so the outline and drop shadow are never clipped. */
  padding: number;
}

function measureWidth(ctx: SKRSContext2D, text: string, fontSize: number): number {
  ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
  return ctx.measureText(text).width;
}

/**
 * Greedy wrap. Words that still overflow at the current size are split so a
 * single token cannot blow the max width.
 */
function wrapLine(ctx: SKRSContext2D, text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  const pushWord = (word: string) => {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measureWidth(ctx, candidate, fontSize) <= maxWidth || current.length === 0) {
      current = candidate;
      return;
    }
    lines.push(current);
    current = word;
  };
  for (const word of words) {
    if (measureWidth(ctx, word, fontSize) <= maxWidth) {
      pushWord(word);
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
      current = '';
    }
    let rest = word;
    while (rest.length > 0) {
      let take = rest.length;
      while (take > 1 && measureWidth(ctx, rest.slice(0, take), fontSize) > maxWidth) {
        take -= 1;
      }
      lines.push(rest.slice(0, take));
      rest = rest.slice(take);
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function lineCountFits(lines: readonly string[]): boolean {
  return lines.length > 0 && lines.length <= MAX_LINES;
}

/**
 * Wraps `text` to at most three lines, shrinking the font down to 60% of the
 * base size when needed, then hard-wrapping leftover words.
 */
export function layoutCue(text: string, canvas: TimelineCanvas): CueLayout {
  ensureFont();
  const trimmed = text.trim();
  const maxWidth = Math.round(canvas.width * MAX_WIDTH_RATIO);
  const baseSize = Math.max(1, Math.round(canvas.height * FONT_SIZE_RATIO));
  const probe = createCanvas(1, 1).getContext('2d');

  let fontSize = baseSize;
  let lines = wrapLine(probe, trimmed, fontSize, maxWidth);
  if (!lineCountFits(lines)) {
    const minSize = Math.max(1, Math.round(baseSize * MIN_FONT_SCALE));
    const scale = Math.min(1, MAX_LINES / Math.max(lines.length, 1));
    fontSize = Math.max(minSize, Math.round(baseSize * scale));
    lines = wrapLine(probe, trimmed, fontSize, maxWidth);
    while (lines.length > MAX_LINES && fontSize > minSize) {
      fontSize -= 1;
      lines = wrapLine(probe, trimmed, fontSize, maxWidth);
    }
    if (lines.length > MAX_LINES) {
      const kept = lines.slice(0, MAX_LINES - 1);
      const overflow = lines.slice(MAX_LINES - 1).join(' ');
      kept.push(overflow);
      lines = kept;
    }
  }

  const outlineWidth = Math.max(1, Math.round(fontSize * OUTLINE_RATIO));
  const textWidth = Math.max(...lines.map((line) => measureWidth(probe, line, fontSize)), 0);
  const lineHeightPx = Math.round(fontSize * LINE_HEIGHT);
  // The text was wrapped to `maxWidth`; the box only adds the outline, the
  // shadow reach and a small margin, so nothing drawn is ever cut off.
  const padding = shadowPadding(outlineWidth);
  const width = Math.ceil(textWidth) + padding * 2;
  const height = lineHeightPx * lines.length + padding * 2;
  return { lines, fontSize, width, height, outlineWidth, padding };
}

/** Outline plus the farthest the blurred shadow reaches, plus a 4 px margin. */
export function shadowPadding(outlineWidth: number): number {
  const shadowReach = SHADOW_BLUR + Math.max(Math.abs(SHADOW_OFFSET_X), Math.abs(SHADOW_OFFSET_Y));
  return outlineWidth + shadowReach + 4;
}
