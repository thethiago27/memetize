import type { MomentForRanking } from '@memetize/clip-ranker';
import type { FeedbackEventLike } from '@memetize/feedback';
import { describe, expect, it } from 'vitest';
import { buildRankerCases } from './cases';
import { evaluateRanker } from './evaluate';

let counter = 0;
function event(
  partial: Partial<FeedbackEventLike> & { kind: FeedbackEventLike['kind'] },
): FeedbackEventLike {
  counter += 1;
  return {
    id: `fb_${String(counter).padStart(4, '0')}`,
    seq: counter,
    projectId: 'prj_1',
    timelineVersion: 1,
    clipId: 'clp_1',
    segmentId: 'seg_1',
    momentId: null,
    assetId: 'ast_1',
    value: null,
    note: null,
    context: {},
    source: 'USER',
    createdAt: new Date(counter * 60_000),
    ...partial,
  };
}

const neutral: MomentForRanking = {
  durationMs: 2000,
  primaryEmotion: null,
  visualEnergy: null,
  qualityScore: null,
  metadata: {},
};
const moments = new Map([
  ['mom_a', neutral],
  ['mom_b', neutral],
  ['mom_c', neutral],
]);

const pool = [
  {
    momentId: 'mom_a',
    assetId: 'ast_1',
    semanticScore: 0.9,
    source: 'CATALOG' as const,
    negativeScore: 0,
  },
  {
    momentId: 'mom_b',
    assetId: 'ast_1',
    semanticScore: 0.8,
    source: 'CATALOG' as const,
    negativeScore: 0,
  },
  {
    momentId: 'mom_c',
    assetId: 'ast_1',
    semanticScore: 0.7,
    source: 'CATALOG' as const,
    negativeScore: 0,
  },
];
const segmentContext = {
  startMs: 0,
  endMs: 2000,
  emotion: 'joy',
  narrativeFunction: 'payoff',
  energy: 0.5,
  retrieved: pool,
};

describe('buildRankerCases', () => {
  it('builds CHOSEN and REJECTED cases from swaps and thumbs-down, adding a missing target', () => {
    const cases = buildRankerCases([
      event({ kind: 'SWAP_OUT', momentId: 'mom_a', context: segmentContext }),
      event({ kind: 'SWAP_IN', momentId: 'mom_b', context: segmentContext }),
      event({ kind: 'CLIP_DOWN', momentId: 'mom_z', context: { ...segmentContext } }),
      event({ kind: 'CLIP_UP', momentId: 'mom_c', context: segmentContext }),
      event({ kind: 'SWAP_IN', momentId: 'mom_lonely', context: {} }),
    ]);
    expect(cases.map((c) => [c.expectation, c.target])).toEqual([
      ['REJECTED', 'mom_a'],
      ['CHOSEN', 'mom_b'],
      ['REJECTED', 'mom_z'],
    ]);
    expect(cases[2]?.candidates.map((c) => c.momentId)).toContain('mom_z');
    expect(cases[0]?.segment).toEqual({
      startMs: 0,
      endMs: 2000,
      emotion: 'joy',
      narrativeFunction: 'payoff',
      energy: 0.5,
    });
  });
});

describe('evaluateRanker', () => {
  it('scores with only the feedback that preceded each case', () => {
    // First swap: the editor prefers mom_b over mom_a with no prior memory,
    // so semantic order (mom_a first) still wins: chosen at position 2.
    const first = [
      event({ kind: 'SWAP_OUT', momentId: 'mom_a', context: segmentContext }),
      event({ kind: 'SWAP_IN', momentId: 'mom_b', context: segmentContext }),
    ];
    // Repeat the same correction many times so the learned usage term
    // outweighs the 0.1 semantic gap, then a final swap-in should rank first.
    const repeats: FeedbackEventLike[] = [];
    for (let i = 0; i < 12; i += 1) {
      repeats.push(
        event({
          kind: 'SWAP_OUT',
          momentId: 'mom_a',
          context: segmentContext,
        }),
        event({
          kind: 'SWAP_IN',
          momentId: 'mom_b',
          context: segmentContext,
        }),
      );
    }
    const events = [...first, ...repeats];
    const cases = buildRankerCases(events);
    const result = evaluateRanker({ cases, events, moments });

    const firstChosen = result.cases.find((c) => c.id === first[1]?.id);
    expect(firstChosen?.position).toBe(2);
    const lastChosen = result.cases.at(-1);
    expect(lastChosen?.expectation).toBe('CHOSEN');
    expect(lastChosen?.position).toBe(1);
    const lastRejected = result.cases.at(-2);
    expect(lastRejected?.expectation).toBe('REJECTED');
    expect(lastRejected?.position).toBeGreaterThan(1);

    expect(result.caseCount).toBe(26);
    expect(result.chosen.count).toBe(13);
    expect(result.rejected.count).toBe(13);
    expect(result.chosen.top3).toBe(1);
    expect(result.chosen.top1).toBeGreaterThan(0.5);
    expect(result.rejected.stillTop1).toBeLessThan(0.5);
    expect(result.chosen.mrr).toBeGreaterThan(0.5);
  });

  it('skips cases whose target moment row is unknown', () => {
    const events = [event({ kind: 'SWAP_IN', momentId: 'mom_gone', context: segmentContext })];
    const result = evaluateRanker({ cases: buildRankerCases(events), events, moments });
    expect(result.skipped).toBe(1);
    expect(result.chosen.count).toBe(0);
    expect(result.cases[0]?.position).toBeNull();
  });
});
