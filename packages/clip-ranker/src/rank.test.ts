import type { RetrievedCandidate } from '@memetize/contracts';
import { describe, expect, it } from 'vitest';
import { RANK_WEIGHTS, rank, rankCandidates, type SegmentForRanking } from './rank';

const candidate: RetrievedCandidate = { momentId: 'mom_1', assetId: 'ast_1', semanticScore: 0.9 };

const segment: SegmentForRanking = {
  startMs: 0,
  endMs: 2000,
  emotion: 'confidence',
  narrativeFunction: 'setup',
  energy: 0.6,
};

const noPriorShortlist = new Set<string>();

describe('RANK_WEIGHTS', () => {
  it('sums to 1 (spec section 29)', () => {
    const total = Object.values(RANK_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('rank', () => {
  it('scores an emotion match higher than a mismatch', () => {
    const match = rank({
      candidate,
      moment: {
        durationMs: 2000,
        primaryEmotion: 'confidence',
        visualEnergy: 0.6,
        qualityScore: 0.8,
        metadata: {},
      },
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    const mismatch = rank({
      candidate,
      moment: {
        durationMs: 2000,
        primaryEmotion: 'sadness',
        visualEnergy: 0.6,
        qualityScore: 0.8,
        metadata: {},
      },
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    expect(match.emotionScore).toBe(1);
    expect(mismatch.emotionScore).toBe(0);
    expect(match.finalScore).toBeGreaterThan(mismatch.finalScore);
  });

  it('scores an identical-duration moment higher than one 10x too long', () => {
    const identical = rank({
      candidate,
      moment: {
        durationMs: 2000,
        primaryEmotion: null,
        visualEnergy: null,
        qualityScore: null,
        metadata: {},
      },
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    const tenTimesLonger = rank({
      candidate,
      moment: {
        durationMs: 20000,
        primaryEmotion: null,
        visualEnergy: null,
        qualityScore: null,
        metadata: {},
      },
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    expect(identical.durationScore).toBe(1);
    expect(identical.finalScore).toBeGreaterThan(tenTimesLonger.finalScore);
  });

  it('defaults every missing optional field to 0.5 rather than 0', () => {
    const result = rank({
      candidate,
      moment: {
        durationMs: segment.endMs - segment.startMs,
        primaryEmotion: null,
        visualEnergy: null,
        qualityScore: null,
        metadata: {},
      },
      segment: { ...segment, emotion: 'neutral' },
      previouslyShortlisted: noPriorShortlist,
    });
    expect(result.emotionScore).toBe(0.5);
    expect(result.narrativeScore).toBe(0.5);
    expect(result.energyScore).toBe(0.5);
    expect(result.qualityScore).toBe(0.5);
  });

  it('is deterministic: the same input always yields the same finalScore', () => {
    const moment = {
      durationMs: 2200,
      primaryEmotion: 'confidence',
      visualEnergy: 0.55,
      qualityScore: 0.7,
      metadata: { memeFunctions: ['setup'] },
    };
    const first = rank({ candidate, moment, segment, previouslyShortlisted: noPriorShortlist });
    const second = rank({ candidate, moment, segment, previouslyShortlisted: noPriorShortlist });
    expect(first).toEqual(second);
  });

  it('penalizes a moment already shortlisted elsewhere in the project (novelty)', () => {
    const moment = {
      durationMs: 2000,
      primaryEmotion: null,
      visualEnergy: null,
      qualityScore: null,
      metadata: {},
    };
    const fresh = rank({ candidate, moment, segment, previouslyShortlisted: noPriorShortlist });
    const reused = rank({
      candidate,
      moment,
      segment,
      previouslyShortlisted: new Set([candidate.momentId]),
    });
    expect(fresh.noveltyScore).toBe(1);
    expect(reused.noveltyScore).toBe(0.2);
    expect(fresh.finalScore).toBeGreaterThan(reused.finalScore);
  });
});

describe('rankCandidates', () => {
  it('sorts by finalScore descending and caps at the given limit', () => {
    const candidates: RetrievedCandidate[] = [
      { momentId: 'mom_low', assetId: 'ast_1', semanticScore: 0.1 },
      { momentId: 'mom_high', assetId: 'ast_2', semanticScore: 0.95 },
      { momentId: 'mom_mid', assetId: 'ast_3', semanticScore: 0.5 },
    ];
    const moments = new Map(
      candidates.map((candidate) => [
        candidate.momentId,
        {
          durationMs: segment.endMs - segment.startMs,
          primaryEmotion: null,
          visualEnergy: null,
          qualityScore: null,
          metadata: {},
        },
      ]),
    );

    const ranked = rankCandidates({
      candidates,
      moments,
      segment,
      previouslyShortlisted: noPriorShortlist,
      limit: 2,
    });

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.momentId).toBe('mom_high');
    expect(ranked[1]?.momentId).toBe('mom_mid');
  });

  it('drops candidates with no matching moment instead of throwing', () => {
    const ranked = rankCandidates({
      candidates: [{ momentId: 'mom_missing', assetId: 'ast_1', semanticScore: 0.9 }],
      moments: new Map(),
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    expect(ranked).toEqual([]);
  });
});
