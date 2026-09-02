import type { SegmentForRanking } from '@memetize/clip-ranker';
import type { RetrievedCandidate } from '@memetize/contracts';
import type { FeedbackEventLike } from '@memetize/feedback';

export type RankerExpectation = 'CHOSEN' | 'REJECTED';

/** One replayable editorial decision (editorial-memory spec). */
export interface RankerCase {
  id: string;
  createdAt: Date;
  projectId: string | null;
  kind: FeedbackEventLike['kind'];
  segment: SegmentForRanking;
  candidates: RetrievedCandidate[];
  target: string;
  expectation: RankerExpectation;
}

const EXPECTATION_BY_KIND: Partial<Record<FeedbackEventLike['kind'], RankerExpectation>> = {
  SWAP_IN: 'CHOSEN',
  SWAP_OUT: 'REJECTED',
  CLIP_DOWN: 'REJECTED',
};

/** Neutral score for a target the pool did not contain (no retrieval evidence either way). */
export const MISSING_TARGET_SCORE = 0.5;

/**
 * Turns swap and thumbs-down events into ranker cases. A case needs the
 * segment snapshot and at least two candidates once the target is in the
 * pool; anything thinner has nothing to rank.
 */
export function buildRankerCases(events: readonly FeedbackEventLike[]): RankerCase[] {
  const cases: RankerCase[] = [];
  for (const event of events) {
    const expectation = EXPECTATION_BY_KIND[event.kind];
    if (!expectation || !event.momentId || !event.assetId) continue;
    const context = event.context;
    const pool = [...(context.retrieved ?? [])];
    if (!pool.some((candidate) => candidate.momentId === event.momentId)) {
      pool.push({
        momentId: event.momentId,
        assetId: event.assetId,
        semanticScore: MISSING_TARGET_SCORE,
        source: 'CATALOG',
        negativeScore: 0,
      });
    }
    if (pool.length < 2) continue;
    cases.push({
      id: event.id,
      createdAt: event.createdAt,
      projectId: event.projectId,
      kind: event.kind,
      segment: {
        startMs: context.startMs ?? 0,
        endMs: context.endMs ?? Math.max(1, context.startMs ?? 0) + 1,
        emotion: context.emotion ?? '',
        narrativeFunction: context.narrativeFunction ?? '',
        energy: context.energy ?? 0.5,
      },
      candidates: pool,
      target: event.momentId,
      expectation,
    });
  }
  return cases;
}
