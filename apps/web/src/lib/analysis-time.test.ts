import { describe, expect, it } from 'vitest';
import { lineAt, thin, toOutput, toPercent, toSource } from './analysis-time';

const window = { sourceStartMs: 30_000, sourceEndMs: 90_000 };

describe('toPercent', () => {
  it('maps a time to its fraction of the duration', () => {
    expect(toPercent(30_000, 120_000)).toBe(0.25);
  });

  it('clamps to [0, 1] and tolerates a zero duration', () => {
    expect(toPercent(-5, 100)).toBe(0);
    expect(toPercent(500, 100)).toBe(1);
    expect(toPercent(50, 0)).toBe(0);
  });
});

describe('toSource / toOutput', () => {
  it('round-trips inside the window', () => {
    const source = toSource(12_345, window);
    expect(source).toBe(42_345);
    expect(toOutput(source, window)).toBe(12_345);
  });

  it('returns null outside the window, inclusive at both edges', () => {
    expect(toOutput(29_999, window)).toBeNull();
    expect(toOutput(30_000, window)).toBe(0);
    expect(toOutput(90_000, window)).toBe(60_000);
    expect(toOutput(90_001, window)).toBeNull();
  });
});

describe('lineAt', () => {
  const lines = [
    { startMs: 0, endMs: 1000, text: 'a' },
    { startMs: 800, endMs: 2000, text: 'b' },
    { startMs: 3000, endMs: 4000, text: 'c' },
  ];

  it('returns the containing line', () => {
    expect(lineAt(lines, 3500)?.text).toBe('c');
  });

  it('prefers the first line when ranges overlap', () => {
    expect(lineAt(lines, 900)?.text).toBe('a');
  });

  it('returns null between lines and at an exclusive end', () => {
    expect(lineAt(lines, 2500)).toBeNull();
    expect(lineAt(lines, 4000)).toBeNull();
  });
});

describe('thin', () => {
  it('returns the input untouched when under the cap', () => {
    const items = [1, 2, 3];
    expect(thin(items, 5)).toEqual(items);
  });

  it('caps the count and keeps the first and last items', () => {
    const items = Array.from({ length: 10_001 }, (_, i) => i);
    const out = thin(items, 2000);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(10_000);
  });
});
