import { describe, expect, it } from 'vitest';
import {
  RANK_LIMIT,
  RankedCandidate,
  RETRIEVE_LIMIT,
  RetrievedCandidate,
  SHORTLIST_LIMIT,
  ShortlistCandidate,
} from './match';

describe('matching pipeline contracts', () => {
  it('exposes the funnel limits from the spec (50 / 10 / 3)', () => {
    expect(RETRIEVE_LIMIT).toBe(50);
    expect(RANK_LIMIT).toBe(10);
    expect(SHORTLIST_LIMIT).toBe(3);
  });

  it('parses a retrieved candidate with a score in [0, 1]', () => {
    expect(
      RetrievedCandidate.safeParse({ momentId: 'mom_1', assetId: 'ast_1', semanticScore: 0.94 })
        .success,
    ).toBe(true);
    expect(
      RetrievedCandidate.safeParse({ momentId: 'mom_1', assetId: 'ast_1', semanticScore: 1.5 })
        .success,
    ).toBe(false);
  });

  it('rejects a ranked candidate whose finalScore falls outside [0, 1]', () => {
    const base = {
      momentId: 'mom_1',
      assetId: 'ast_1',
      semanticScore: 0.9,
      emotionScore: 0.5,
      narrativeScore: 0.5,
      durationScore: 0.5,
      energyScore: 0.5,
      qualityScore: 0.5,
      noveltyScore: 1,
      usageScore: 1,
    };
    expect(RankedCandidate.safeParse({ ...base, finalScore: 0.72 }).success).toBe(true);
    expect(RankedCandidate.safeParse({ ...base, finalScore: -0.1 }).success).toBe(false);
  });

  it('parses a shortlist candidate with an empty penalties default', () => {
    const result = ShortlistCandidate.safeParse({
      momentId: 'mom_1',
      assetId: 'ast_1',
      finalScore: 0.8,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.penalties).toEqual([]);
  });

  it('rejects a shortlist candidate with an out-of-range finalScore', () => {
    const result = ShortlistCandidate.safeParse({
      momentId: 'mom_1',
      assetId: 'ast_1',
      finalScore: 1.2,
      penalties: [],
    });
    expect(result.success).toBe(false);
  });
});
