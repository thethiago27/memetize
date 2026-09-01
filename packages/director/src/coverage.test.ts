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

  it('throws when no moment can cover the minimum slot', () => {
    expect(() => resolveCoverage(insufficientFixture())).toThrow(InsufficientCatalogError);
  });
});
