import { DEFAULT_CANVAS } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import {
  FONT_SIZE_RATIO,
  LINE_HEIGHT,
  MAX_LINES,
  MIN_FONT_SCALE,
  SHADOW_BLUR,
  SHADOW_OFFSET_X,
  SHADOW_OFFSET_Y,
} from './constants';
import { layoutCue, shadowPadding } from './layout';
import { rasterizeCue } from './rasterize';

describe('layoutCue', () => {
  it('keeps a short line on one row at the base font size', () => {
    const layout = layoutCue('olá mundo', DEFAULT_CANVAS);
    expect(layout.lines).toEqual(['olá mundo']);
    expect(layout.fontSize).toBe(Math.round(DEFAULT_CANVAS.height * FONT_SIZE_RATIO));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('wraps a long sentence instead of overflowing the max width', () => {
    const layout = layoutCue(
      'eu achava que estava tudo bem até o momento em que percebi que não',
      DEFAULT_CANVAS,
    );
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it('shrinks the font for a very long word and still hard-wraps it', () => {
    const layout = layoutCue('supercalifragilisticexpialidocious'.repeat(4), DEFAULT_CANVAS);
    expect(layout.fontSize).toBeLessThanOrEqual(
      Math.round(DEFAULT_CANVAS.height * FONT_SIZE_RATIO),
    );
    expect(layout.fontSize).toBeGreaterThanOrEqual(
      Math.round(DEFAULT_CANVAS.height * FONT_SIZE_RATIO * MIN_FONT_SCALE),
    );
    expect(layout.lines.length).toBeGreaterThan(0);
    expect(layout.lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it('is deterministic for the same text and canvas', () => {
    const first = layoutCue('mesmo texto', DEFAULT_CANVAS);
    const second = layoutCue('mesmo texto', DEFAULT_CANVAS);
    expect(second).toEqual(first);
  });
});

describe('layoutCue padding', () => {
  it('reserves room for the outline and the drop shadow on every side', () => {
    const layout = layoutCue('sombra', DEFAULT_CANVAS);
    const reach = SHADOW_BLUR + Math.max(Math.abs(SHADOW_OFFSET_X), Math.abs(SHADOW_OFFSET_Y));
    expect(layout.padding).toBe(shadowPadding(layout.outlineWidth));
    expect(layout.padding).toBeGreaterThan(layout.outlineWidth + reach);
    expect(layout.height).toBe(
      Math.round(layout.fontSize * LINE_HEIGHT) * layout.lines.length + layout.padding * 2,
    );
  });
});

describe('rasterizeCue', () => {
  it('returns a PNG whose dimensions match the layout', () => {
    const layout = layoutCue('legendas', DEFAULT_CANVAS);
    const png = rasterizeCue(layout);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(layout.width);
    expect(height).toBe(layout.height);
  });
});
