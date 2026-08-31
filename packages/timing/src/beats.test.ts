import { describe, expect, it } from 'vitest';
import { mergeBeats } from './beats';

describe('mergeBeats', () => {
  it('merges a downbeat into an existing beat within tolerance instead of duplicating it', () => {
    const merged = mergeBeats([{ timeMs: 1000, strength: 0.6 }], [1005]);

    expect(merged).toEqual([{ timeMs: 1000, strength: 0.6, isDownbeat: true }]);
  });

  it('inserts a downbeat with no nearby beat as its own point at full strength', () => {
    const merged = mergeBeats([{ timeMs: 1000, strength: 0.6 }], [2000]);

    expect(merged).toEqual([
      { timeMs: 1000, strength: 0.6, isDownbeat: false },
      { timeMs: 2000, strength: 1, isDownbeat: true },
    ]);
  });

  it('returns points sorted ascending by time regardless of input order', () => {
    const merged = mergeBeats(
      [
        { timeMs: 2000, strength: 0.5 },
        { timeMs: 500, strength: 0.4 },
      ],
      [1000],
    );

    expect(merged.map((beat) => beat.timeMs)).toEqual([500, 1000, 2000]);
  });

  it('returns an empty list when given no beats and no downbeats', () => {
    expect(mergeBeats([], [])).toEqual([]);
  });
});
