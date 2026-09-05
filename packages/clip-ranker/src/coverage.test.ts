import type { RankedCandidate } from '@memetize/contracts';
import { describe, expect, it } from 'vitest';
import { ensureCoverageCandidates } from './coverage';

function ranked(momentId: string, finalScore: number): RankedCandidate {
  return {
    momentId,
    assetId: `ast_${momentId}`,
    semanticScore: finalScore,
    emotionScore: 1,
    narrativeScore: 1,
    durationScore: 1,
    energyScore: 1,
    qualityScore: 1,
    noveltyScore: 1,
    usageScore: 1,
    finalScore,
  };
}

describe('ensureCoverageCandidates', () => {
  const durations = new Map<string, number>([
    ['a', 1500],
    ['b', 1420],
    ['c', 1293],
    ['long1', 2400],
    ['long2', 3000],
    ['short', 600],
  ]);

  it('returns the plain top slice when it already covers the segment', () => {
    const all = [ranked('long1', 0.9), ranked('a', 0.8), ranked('b', 0.7)];
    expect(ensureCoverageCandidates(all, durations, 1553, 2).map((e) => e.momentId)).toEqual([
      'long1',
      'a',
    ]);
  });

  it('swaps the lowest-scoring entries for the best covering candidates below the cut', () => {
    // Top 3 by score are all shorter than the 1553 ms segment; two long moments sit below.
    const all = [
      ranked('a', 0.46),
      ranked('b', 0.46),
      ranked('c', 0.45),
      ranked('long1', 0.4),
      ranked('short', 0.39),
      ranked('long2', 0.3),
    ];
    const result = ensureCoverageCandidates(all, durations, 1553, 3).map((e) => e.momentId);
    expect(result).toHaveLength(3);
    expect(result).toEqual(['a', 'long1', 'long2']);
  });

  it('leaves the list unchanged when nothing in the catalog can cover the segment', () => {
    const all = [ranked('a', 0.5), ranked('b', 0.4), ranked('short', 0.3)];
    expect(ensureCoverageCandidates(all, durations, 5000, 2).map((e) => e.momentId)).toEqual([
      'a',
      'b',
    ]);
  });
});
