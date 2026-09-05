import { RANK_LIMIT, type RankedCandidate } from '@memetize/contracts';

/** How many coverage-capable candidates the ranked list keeps at minimum. */
export const COVERAGE_KEEP = 2;

/**
 * Keeps the ranked list able to cover its segment. `rankCandidates` keeps the
 * top `limit` by score, which for a short segment can be `limit` moments all
 * shorter than the segment: the coverage resolver then has nothing that fills
 * the span and reports `INSUFFICIENT_CATALOG` with a full catalog. This takes
 * the full ranking, and when the top slice holds no moment at least
 * `segmentDurationMs` long, swaps its lowest-scoring entries for the best
 * covering candidates (up to `COVERAGE_KEEP`), so the list stays `limit` long
 * and ordered by score. Ranked lists that already cover are returned as is.
 */
export function ensureCoverageCandidates(
  rankedAll: readonly RankedCandidate[],
  durationById: ReadonlyMap<string, number>,
  segmentDurationMs: number,
  limit: number = RANK_LIMIT,
): RankedCandidate[] {
  const sorted = [...rankedAll].sort((a, b) => b.finalScore - a.finalScore);
  const top = sorted.slice(0, limit);
  const covers = (entry: RankedCandidate) =>
    (durationById.get(entry.momentId) ?? 0) >= segmentDurationMs;
  if (segmentDurationMs <= 0 || top.some(covers)) return top;

  const covering = sorted.slice(limit).filter(covers).slice(0, COVERAGE_KEEP);
  if (covering.length === 0) return top;
  const keep = Math.max(0, limit - covering.length);
  return [...top.slice(0, keep), ...covering].sort((a, b) => b.finalScore - a.finalScore);
}
