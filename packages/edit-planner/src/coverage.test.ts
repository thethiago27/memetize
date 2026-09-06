import { describe, expect, it } from 'vitest';
import { MAX_VISUAL_SLOT_MS, MIN_VISUAL_SLOT_MS } from './constants';
import { type CoverageSuggestion, planNarrativeCoverage } from './coverage';

function lyric(startMs: number, endMs: number): CoverageSuggestion {
  return {
    startMs,
    endMs,
    lyrics: 'fixture lyric',
    meaning: 'fixture meaning',
    emotion: 'neutral',
    narrativeFunction: 'verse',
    visualIdeas: ['reaction'],
    literalness: 0.5,
    ironyPotential: 0.5,
    energy: 0.5,
  };
}

describe('planNarrativeCoverage', () => {
  it('fills lyric gaps with instrumental spans and covers the window exactly', () => {
    const result = planNarrativeCoverage({
      window: { sourceStartMs: 10_000, sourceEndMs: 16_000 },
      suggestions: [lyric(11_000, 13_000), lyric(14_000, 15_000)],
      sections: [{ type: 'chorus', startMs: 10_000, endMs: 16_000 }],
      beats: [10_000, 11_000, 12_000, 13_000, 14_000, 15_000, 16_000],
      energyCurve: [{ timeMs: 10_000, value: 0.8 }],
    });
    expect(result[0]?.startMs).toBe(10_000);
    expect(result.at(-1)?.endMs).toBe(16_000);
    expect(result.some((segment) => segment.sourceKind === 'INSTRUMENTAL')).toBe(true);
    result.slice(1).forEach((segment, index) => {
      expect(result[index]?.endMs).toBe(segment.startMs);
    });
  });

  it('merges a terminal remainder shorter than one second', () => {
    const result = planNarrativeCoverage({
      window: { sourceStartMs: 0, sourceEndMs: 4_500 },
      suggestions: [],
      sections: [{ type: 'verse', startMs: 0, endMs: 4_500 }],
      beats: [0, 2_000, 4_000, 4_500],
      energyCurve: [],
    });
    expect(result.every((segment) => segment.endMs - segment.startMs >= 1_000)).toBe(true);
  });
});

describe('splitSpan: no span exceeds the maximum visual slot', () => {
  it('splits a long span on time when no beat is usable', () => {
    // 12s of instrumental with no beats at all. The loop used to `break` when
    // `pickSplitBeat` found nothing, returning the whole 12s span — longer than
    // MAX_VISUAL_SLOT_MS, which is exactly what this split exists to prevent.
    const result = planNarrativeCoverage({
      window: { sourceStartMs: 0, sourceEndMs: 12_000 },
      suggestions: [],
      sections: [{ type: 'instrumental', startMs: 0, endMs: 12_000 }],
      beats: [],
      energyCurve: [{ timeMs: 0, value: 0.5 }],
    });

    expect(result.length).toBeGreaterThan(1);
    for (const segment of result) {
      const durationMs = segment.endMs - segment.startMs;
      expect(durationMs).toBeLessThanOrEqual(MAX_VISUAL_SLOT_MS);
      expect(durationMs).toBeGreaterThanOrEqual(MIN_VISUAL_SLOT_MS);
    }
    expect(result[0]?.startMs).toBe(0);
    expect(result.at(-1)?.endMs).toBe(12_000);
  });

  it('splits a span between one and two slots evenly', () => {
    // 4.5s: longer than one slot, too short to cut at MAX and leave a usable
    // tail. Two halves instead of one oversized span.
    const result = planNarrativeCoverage({
      window: { sourceStartMs: 0, sourceEndMs: 4_500 },
      suggestions: [],
      sections: [{ type: 'instrumental', startMs: 0, endMs: 4_500 }],
      beats: [],
      energyCurve: [{ timeMs: 0, value: 0.5 }],
    });

    expect(result).toHaveLength(2);
    for (const segment of result) {
      const durationMs = segment.endMs - segment.startMs;
      expect(durationMs).toBeLessThanOrEqual(MAX_VISUAL_SLOT_MS);
      expect(durationMs).toBeGreaterThanOrEqual(MIN_VISUAL_SLOT_MS);
    }
  });
});
