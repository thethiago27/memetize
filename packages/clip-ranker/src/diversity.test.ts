import type { RankedCandidate } from '@memetize/contracts';
import { describe, expect, it } from 'vitest';
import { diversify, type MomentForDiversity, type SegmentRankedInput } from './diversity';

function candidate(momentId: string, assetId: string, finalScore: number): RankedCandidate {
  return {
    momentId,
    assetId,
    semanticScore: finalScore,
    emotionScore: 0.5,
    narrativeScore: 0.5,
    durationScore: 0.5,
    energyScore: 0.5,
    qualityScore: 0.5,
    noveltyScore: 1,
    usageScore: 1,
    finalScore,
  };
}

const noMoments = new Map<string, MomentForDiversity>();

describe('diversify', () => {
  it('gives the second segment a different asset when the top candidate would repeat one', () => {
    const segments: SegmentRankedInput[] = [
      {
        segmentId: 'nar_1',
        narrativeFunction: 'setup',
        ranked: [candidate('mom_1', 'ast_shared', 0.9), candidate('mom_2', 'ast_other', 0.8)],
      },
      {
        segmentId: 'nar_2',
        narrativeFunction: 'payoff',
        ranked: [candidate('mom_3', 'ast_shared', 0.95), candidate('mom_4', 'ast_third', 0.7)],
      },
    ];

    const shortlists = diversify(segments, noMoments);

    const first = shortlists.get('nar_1');
    const second = shortlists.get('nar_2');
    expect(first?.[0]?.assetId).toBe('ast_shared');
    // mom_3 would have won on score alone, but ast_shared is already used.
    expect(second?.[0]?.assetId).toBe('ast_third');
    expect(second?.some((entry) => entry.assetId === 'ast_shared')).toBe(false);
  });

  it('relaxes the same-asset rule when the catalog only has one asset, and never empties the shortlist', () => {
    const segments: SegmentRankedInput[] = [
      {
        segmentId: 'nar_1',
        narrativeFunction: 'setup',
        ranked: [candidate('mom_1', 'ast_only', 0.9)],
      },
      {
        segmentId: 'nar_2',
        narrativeFunction: 'payoff',
        ranked: [candidate('mom_2', 'ast_only', 0.8)],
      },
    ];

    const shortlists = diversify(segments, noMoments);

    const second = shortlists.get('nar_2');
    expect(second).toHaveLength(1);
    expect(second?.[0]?.momentId).toBe('mom_2');
    expect(second?.[0]?.penalties).toContain('same_asset_relaxed');
  });

  it('processes segments in the order given (temporal order), not by score', () => {
    const segments: SegmentRankedInput[] = [
      {
        segmentId: 'nar_early',
        narrativeFunction: 'setup',
        ranked: [candidate('mom_a', 'ast_a', 0.5)],
      },
      {
        segmentId: 'nar_late',
        narrativeFunction: 'payoff',
        ranked: [candidate('mom_b', 'ast_b', 0.99)],
      },
    ];

    const shortlists = diversify(segments, noMoments);
    const keysInOrder = Array.from(shortlists.keys());
    expect(keysInOrder).toEqual(['nar_early', 'nar_late']);
  });

  it('caps each shortlist at the given limit', () => {
    const ranked = Array.from({ length: 10 }, (_, index) =>
      candidate(`mom_${index}`, `ast_${index}`, 1 - index / 100),
    );
    const shortlists = diversify(
      [{ segmentId: 'nar_1', narrativeFunction: 'setup', ranked }],
      noMoments,
      3,
    );
    expect(shortlists.get('nar_1')).toHaveLength(3);
  });

  it('applies the same_category_penalty when memeFunctions overlap with the previous segment', () => {
    const moments = new Map<string, MomentForDiversity>([
      ['mom_1', { memeFunctions: ['sarcasm'], subjects: [] }],
      ['mom_2', { memeFunctions: ['sarcasm'], subjects: [] }],
      ['mom_3', { memeFunctions: ['joy'], subjects: [] }],
    ]);
    const segments: SegmentRankedInput[] = [
      {
        segmentId: 'nar_1',
        narrativeFunction: 'setup',
        ranked: [candidate('mom_1', 'ast_1', 0.9)],
      },
      {
        segmentId: 'nar_2',
        narrativeFunction: 'payoff',
        ranked: [candidate('mom_2', 'ast_2', 0.9), candidate('mom_3', 'ast_3', 0.5)],
      },
    ];

    const shortlists = diversify(segments, moments);
    const second = shortlists.get('nar_2');
    expect(second?.[0]?.penalties).toContain('same_category_penalty');
    expect(second?.[0]?.finalScore).toBeLessThan(0.9);
  });
});
