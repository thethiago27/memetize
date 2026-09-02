import type { RetrievedCandidate } from '@memetize/contracts';
import { describe, expect, it } from 'vitest';
import {
  NEGATIVE_MATCH_THRESHOLD,
  RANK_WEIGHTS,
  RANKER_VERSION,
  rank,
  rankCandidates,
  type SegmentForRanking,
} from './rank';

function retrieved(
  momentId: string,
  assetId: string,
  semanticScore: number,
  extra: Partial<RetrievedCandidate> = {},
): RetrievedCandidate {
  return { momentId, assetId, semanticScore, source: 'CATALOG', negativeScore: 0, ...extra };
}

const candidate = retrieved('mom_1', 'ast_1', 0.9);

const neutralMoment = {
  durationMs: 2000,
  primaryEmotion: null,
  visualEnergy: null,
  qualityScore: null,
  metadata: {},
};

function usageOf(
  wins: number,
  losses: number,
  byFunction: Record<string, { wins: number; losses: number }> = {},
  projects: string[] = [],
) {
  return {
    wins,
    losses,
    byFunction: new Map(Object.entries(byFunction)),
    projects: new Set(projects),
  };
}

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

describe('rank with editorial memory', () => {
  it('identifies as ranker 2.0.0', () => {
    expect(RANKER_VERSION).toBe('2.0.0');
  });

  it('is neutral (usage 0.5, novelty 1) without feedback', () => {
    const result = rank({
      candidate,
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    expect(result.usageScore).toBe(0.5);
    expect(result.noveltyScore).toBe(1);
  });

  it('raises usage on wins and lowers it on losses', () => {
    const winner = rank({
      candidate,
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
      usage: usageOf(3, 0),
    });
    const loser = rank({
      candidate,
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
      usage: usageOf(0, 3),
    });
    expect(winner.usageScore).toBeGreaterThan(0.5);
    expect(loser.usageScore).toBeLessThan(0.5);
    expect(winner.finalScore).toBeGreaterThan(loser.finalScore);
  });

  it('weighs the segment narrative role separately from the global record', () => {
    // 2 wins overall, but both losses came as "setup" — the current role.
    const asSetup = rank({
      candidate,
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
      usage: usageOf(2, 2, { setup: { wins: 0, losses: 2 }, payoff: { wins: 2, losses: 0 } }),
    });
    const asPayoff = rank({
      candidate,
      moment: neutralMoment,
      segment: { ...segment, narrativeFunction: 'payoff' },
      previouslyShortlisted: noPriorShortlist,
      usage: usageOf(2, 2, { setup: { wins: 0, losses: 2 }, payoff: { wins: 2, losses: 0 } }),
    });
    expect(asPayoff.usageScore).toBeGreaterThan(asSetup.usageScore);
    expect(asSetup.usageScore).toBeCloseTo(0.5 * 0.5 + 0.5 * (1 / 4), 10);
  });

  it('damps usage only when a NEGATIVE feedback vector crosses the threshold', () => {
    const below = rank({
      candidate: retrieved('mom_1', 'ast_1', 0.9, {
        negativeScore: NEGATIVE_MATCH_THRESHOLD - 0.01,
      }),
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    const above = rank({
      candidate: retrieved('mom_1', 'ast_1', 0.9, { negativeScore: 1 }),
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    expect(below.usageScore).toBe(0.5);
    expect(above.usageScore).toBe(0.25);
  });

  it('lowers novelty for cross-project reuse down to a floor of 0.5', () => {
    const once = rank({
      candidate,
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
      usage: usageOf(0, 0, {}, ['prj_other']),
      projectId: 'prj_me',
    });
    const own = rank({
      candidate,
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
      usage: usageOf(0, 0, {}, ['prj_me']),
      projectId: 'prj_me',
    });
    const many = rank({
      candidate,
      moment: neutralMoment,
      segment,
      previouslyShortlisted: noPriorShortlist,
      usage: usageOf(0, 0, {}, ['p1', 'p2', 'p3', 'p4', 'p5']),
      projectId: 'prj_me',
    });
    expect(own.noveltyScore).toBe(1);
    expect(once.noveltyScore).toBeCloseTo(1 - 0.5 / 3, 10);
    expect(many.noveltyScore).toBe(0.5);
  });

  it('keeps the in-project shortlist penalty ahead of cross-project reuse', () => {
    const reused = rank({
      candidate,
      moment: neutralMoment,
      segment,
      previouslyShortlisted: new Set(['mom_1']),
      usage: usageOf(0, 0, {}, ['p1', 'p2', 'p3']),
      projectId: 'prj_me',
    });
    expect(reused.noveltyScore).toBe(0.2);
  });
});

describe('rankCandidates', () => {
  it('sorts by finalScore descending and caps at the given limit', () => {
    const candidates: RetrievedCandidate[] = [
      retrieved('mom_low', 'ast_1', 0.1),
      retrieved('mom_high', 'ast_2', 0.95),
      retrieved('mom_mid', 'ast_3', 0.5),
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
      usage: new Map([['mom_mid', usageOf(5, 0)]]),
      projectId: 'prj_me',
      limit: 2,
    });

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.momentId).toBe('mom_high');
    expect(ranked[1]?.momentId).toBe('mom_mid');
  });

  it('drops candidates with no matching moment instead of throwing', () => {
    const ranked = rankCandidates({
      candidates: [retrieved('mom_missing', 'ast_1', 0.9)],
      moments: new Map(),
      segment,
      previouslyShortlisted: noPriorShortlist,
    });
    expect(ranked).toEqual([]);
  });
});
