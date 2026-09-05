import { describe, expect, it } from 'vitest';
import type { AssembleSegmentMatch } from './assemble';
import { InsufficientCatalogError, type ResolveCoverageInput, resolveCoverage } from './coverage';

function matchMap(segmentId: string, momentIds: string[]): Map<string, AssembleSegmentMatch> {
  const ranked = momentIds.map((momentId, index) => ({
    momentId,
    assetId: momentId.replace('mom_', 'ast_'),
    semanticScore: 1 - index * 0.1,
    emotionScore: 1,
    narrativeScore: 1,
    durationScore: 1,
    energyScore: 1,
    qualityScore: 1,
    noveltyScore: 1,
    usageScore: 1,
    finalScore: 1 - index * 0.1,
  }));
  return new Map([
    [
      segmentId,
      {
        ranked,
        shortlist: ranked.map(({ momentId, assetId, finalScore }) => ({
          momentId,
          assetId,
          finalScore,
          penalties: [],
        })),
      },
    ],
  ]);
}

function fallbackFixture(): ResolveCoverageInput {
  return {
    window: { sourceStartMs: 0, sourceEndMs: 1_000 },
    segments: [{ id: 'nar_1', startMs: 0, endMs: 1_000 }],
    picks: [],
    matches: matchMap('nar_1', ['mom_top']),
    moments: new Map([
      ['mom_top', { assetId: 'ast_top', startMs: 0, endMs: 1_000, durationMs: 1_000 }],
    ]),
    beats: [0, 1_000],
  };
}

function insufficientFixture(): ResolveCoverageInput {
  return {
    window: { sourceStartMs: 0, sourceEndMs: 1_000 },
    segments: [{ id: 'nar_1', startMs: 0, endMs: 1_000 }],
    picks: [],
    matches: matchMap('nar_1', ['mom_short']),
    moments: new Map([
      ['mom_short', { assetId: 'ast_short', startMs: 0, endMs: 500, durationMs: 500 }],
    ]),
    beats: [0, 1_000],
  };
}

describe('resolveCoverage', () => {
  it('tiles a three-second span with two short moments and no frozen tail', () => {
    const result = resolveCoverage({
      window: { sourceStartMs: 10_000, sourceEndMs: 13_000 },
      segments: [{ id: 'nar_1', startMs: 10_000, endMs: 13_000 }],
      picks: [{ segmentId: 'nar_1', momentId: 'mom_a' }],
      matches: matchMap('nar_1', ['mom_a', 'mom_b']),
      moments: new Map([
        ['mom_a', { assetId: 'ast_a', startMs: 0, endMs: 1_200, durationMs: 1_200 }],
        ['mom_b', { assetId: 'ast_b', startMs: 2_000, endMs: 3_800, durationMs: 1_800 }],
      ]),
      beats: [10_000, 11_200, 13_000],
    });
    expect(result.clips.map((clip) => clip.timeline)).toEqual([
      { startMs: 0, endMs: 1_200 },
      { startMs: 1_200, endMs: 3_000 },
    ]);
    expect(
      result.clips.every(
        (clip) =>
          clip.source.endMs - clip.source.startMs === clip.timeline.endMs - clip.timeline.startMs,
      ),
    ).toBe(true);
  });

  it('uses the top eligible fallback when the provider omits a pick', () => {
    expect(resolveCoverage(fallbackFixture()).clips[0]?.momentId).toBe('mom_top');
  });

  it('uses an eligible Director primary before a full-cover fallback', () => {
    const result = resolveCoverage({
      window: { sourceStartMs: 0, sourceEndMs: 2_500 },
      segments: [{ id: 'nar_1', startMs: 0, endMs: 2_500 }],
      picks: [{ segmentId: 'nar_1', momentId: 'mom_primary' }],
      matches: matchMap('nar_1', ['mom_primary', 'mom_fallback']),
      moments: new Map([
        ['mom_primary', { assetId: 'ast_primary', startMs: 0, endMs: 1_500, durationMs: 1_500 }],
        ['mom_fallback', { assetId: 'ast_fallback', startMs: 0, endMs: 2_500, durationMs: 2_500 }],
      ]),
      beats: [0, 1_500, 2_500],
    });

    expect(result.clips.map((clip) => clip.momentId)).toEqual(['mom_primary', 'mom_fallback']);
    expect(result.clips.map((clip) => clip.timeline)).toEqual([
      { startMs: 0, endMs: 1_500 },
      { startMs: 1_500, endMs: 2_500 },
    ]);
    expect(result.decisions[0]).toMatchObject({
      momentId: 'mom_primary',
      role: 'primary',
    });
  });

  it('skips a primary that would leave an unabsorbable tail and uses a full-cover candidate', () => {
    // Real case: a 1898 ms segment, Director pick of 1867 ms, and a 1933 ms
    // candidate further down the ranking. The pick alone leaves 31 ms.
    const result = resolveCoverage({
      window: { sourceStartMs: 89_002, sourceEndMs: 149_002 },
      segments: [{ id: 'nar_1', startMs: 108_042, endMs: 109_940 }],
      picks: [{ segmentId: 'nar_1', momentId: 'mom_pick' }],
      matches: matchMap('nar_1', ['mom_pick', 'mom_also_short', 'mom_cover']),
      moments: new Map([
        ['mom_pick', { assetId: 'ast_a', startMs: 0, endMs: 1_867, durationMs: 1_867 }],
        ['mom_also_short', { assetId: 'ast_b', startMs: 0, endMs: 1_867, durationMs: 1_867 }],
        ['mom_cover', { assetId: 'ast_a', startMs: 0, endMs: 1_933, durationMs: 1_933 }],
      ]),
      beats: [108_042, 108_500, 109_940],
    });
    expect(result.clips.map((clip) => [clip.momentId, clip.timeline])).toEqual([
      ['mom_cover', { startMs: 19_040, endMs: 20_938 }],
    ]);
    expect(result.decisions[0]).toMatchObject({ momentId: 'mom_cover', role: 'fallback' });
  });

  it('covers a 4000ms segment with two 2000ms moments despite adverse beats (F02)', () => {
    // Beats at 0/1500/3000 snap a beat-aware pass to 1500+1500 and strand
    // 1000 ms, but the two moments cover the span outright without snapping.
    const result = resolveCoverage({
      window: { sourceStartMs: 0, sourceEndMs: 4_000 },
      segments: [{ id: 'nar_1', startMs: 0, endMs: 4_000 }],
      picks: [],
      matches: matchMap('nar_1', ['mom_a', 'mom_b']),
      moments: new Map([
        ['mom_a', { assetId: 'ast_a', startMs: 0, endMs: 2_000, durationMs: 2_000 }],
        ['mom_b', { assetId: 'ast_b', startMs: 0, endMs: 2_000, durationMs: 2_000 }],
      ]),
      beats: [0, 1_500, 3_000],
    });
    expect(result.clips.map((clip) => clip.timeline)).toEqual([
      { startMs: 0, endMs: 2_000 },
      { startMs: 2_000, endMs: 4_000 },
    ]);
    // Every clip stays within its source and the fallback reason is annotated.
    expect(
      result.clips.every(
        (clip) =>
          clip.source.endMs - clip.source.startMs === clip.timeline.endMs - clip.timeline.startMs,
      ),
    ).toBe(true);
    expect(result.decisions.every((d) => d.reason.includes('retry without beat snap'))).toBe(true);
  });

  it('still fails when a single 2000ms moment cannot cover a 4000ms segment (F02)', () => {
    expect(() =>
      resolveCoverage({
        window: { sourceStartMs: 0, sourceEndMs: 4_000 },
        segments: [{ id: 'nar_1', startMs: 0, endMs: 4_000 }],
        picks: [],
        matches: matchMap('nar_1', ['mom_only']),
        moments: new Map([
          ['mom_only', { assetId: 'ast_only', startMs: 0, endMs: 2_000, durationMs: 2_000 }],
        ]),
        beats: [0, 1_500, 3_000],
      }),
    ).toThrow(InsufficientCatalogError);
  });

  it('throws when no moment can cover the minimum slot', () => {
    expect(() => resolveCoverage(insufficientFixture())).toThrow(InsufficientCatalogError);
  });

  it('throws when coverage would require an unabsorbable sub-second tail', () => {
    expect(() =>
      resolveCoverage({
        window: { sourceStartMs: 0, sourceEndMs: 1_500 },
        segments: [{ id: 'nar_1', startMs: 0, endMs: 1_500 }],
        picks: [],
        matches: matchMap('nar_1', ['mom_one_second', 'mom_tail']),
        moments: new Map([
          ['mom_one_second', { assetId: 'ast_one', startMs: 0, endMs: 1_000, durationMs: 1_000 }],
          ['mom_tail', { assetId: 'ast_tail', startMs: 0, endMs: 500, durationMs: 500 }],
        ]),
        beats: [0, 1_000, 1_500],
      }),
    ).toThrowError(InsufficientCatalogError);
  });
});
