import { type MomentForRanking, rankCandidates } from '@memetize/clip-ranker';
import { aggregateFeedback, type FeedbackEventLike } from '@memetize/feedback';
import type { RankerCase, RankerExpectation } from './cases';

export interface CaseResult {
  id: string;
  kind: RankerCase['kind'];
  expectation: RankerExpectation;
  /** 1-based rank of the target, null when its moment row is unknown. */
  position: number | null;
  poolSize: number;
}

export interface RankerEvaluation {
  caseCount: number;
  skipped: number;
  chosen: { count: number; top1: number; top3: number; mrr: number };
  rejected: { count: number; stillTop1: number };
  cases: CaseResult[];
}

export interface EvaluateRankerParams {
  cases: readonly RankerCase[];
  events: readonly FeedbackEventLike[];
  moments: ReadonlyMap<string, MomentForRanking>;
  rank?: typeof rankCandidates;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Replays each editorial decision against the ranker with only the feedback
 * that existed before it (leave-one-out by time), so the score measures
 * what the ranker would have done, not what it memorised.
 */
export function evaluateRanker(params: EvaluateRankerParams): RankerEvaluation {
  const rank = params.rank ?? rankCandidates;
  const results: CaseResult[] = [];
  let skipped = 0;

  for (const testCase of params.cases) {
    if (!params.moments.has(testCase.target)) {
      skipped += 1;
      results.push({
        id: testCase.id,
        kind: testCase.kind,
        expectation: testCase.expectation,
        position: null,
        poolSize: testCase.candidates.length,
      });
      continue;
    }
    const aggregate = aggregateFeedback(params.events, { before: testCase.createdAt });
    const ranked = rank({
      candidates: testCase.candidates,
      moments: params.moments,
      segment: testCase.segment,
      previouslyShortlisted: new Set(),
      usage: aggregate.usage,
      projectId: testCase.projectId ?? undefined,
      limit: testCase.candidates.length,
    });
    const index = ranked.findIndex((entry) => entry.momentId === testCase.target);
    results.push({
      id: testCase.id,
      kind: testCase.kind,
      expectation: testCase.expectation,
      position: index === -1 ? null : index + 1,
      poolSize: testCase.candidates.length,
    });
  }

  const chosen = results.filter((r) => r.expectation === 'CHOSEN' && r.position !== null);
  const rejected = results.filter((r) => r.expectation === 'REJECTED' && r.position !== null);

  return {
    caseCount: params.cases.length,
    skipped,
    chosen: {
      count: chosen.length,
      top1: rate(chosen.filter((r) => r.position === 1).length, chosen.length),
      top3: rate(chosen.filter((r) => (r.position ?? Infinity) <= 3).length, chosen.length),
      mrr: rate(
        chosen.reduce((sum, r) => sum + 1 / (r.position ?? Infinity), 0),
        chosen.length,
      ),
    },
    rejected: {
      count: rejected.length,
      stillTop1: rate(rejected.filter((r) => r.position === 1).length, rejected.length),
    },
    cases: results,
  };
}
