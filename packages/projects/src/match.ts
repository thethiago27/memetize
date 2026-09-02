import type { RankedCandidate, RetrievedCandidate, ShortlistCandidate } from '@memetize/contracts';
import {
  type Database,
  type NewSegmentMatchRow,
  type SegmentMatchRow,
  segmentMatches,
} from '@memetize/database';
import { matchId } from '@memetize/shared';
import { and, eq } from 'drizzle-orm';

export interface SegmentMatchInput {
  segmentId: string;
  retrieved: RetrievedCandidate[];
  ranked: RankedCandidate[];
  shortlist: ShortlistCandidate[];
}

export interface ReplaceSegmentMatchesParams {
  projectId: string;
  matches: SegmentMatchInput[];
  ranker: string;
  rankerVersion: string;
  /** Newest feedback event the ranker considered (editorial-memory spec). */
  feedbackCutoffAt?: Date | null;
}

/** Pure builder, mirrors `toNarrativeSegmentRows`. */
export function toSegmentMatchRows(params: ReplaceSegmentMatchesParams): NewSegmentMatchRow[] {
  return params.matches.map((match) => ({
    id: matchId(),
    projectId: params.projectId,
    segmentId: match.segmentId,
    retrieved: match.retrieved,
    ranked: match.ranked,
    shortlist: match.shortlist,
    ranker: params.ranker,
    rankerVersion: params.rankerVersion,
    feedbackCutoffAt: params.feedbackCutoffAt ?? null,
  }));
}

/**
 * Idempotently persists the matching funnel for every segment of a project:
 * existing rows for that `(projectId, ranker, rankerVersion)` are replaced
 * wholesale (spec section 4.2), mirroring `replaceNarrativeSegments`.
 */
export async function replaceSegmentMatches(
  db: Database,
  params: ReplaceSegmentMatchesParams,
): Promise<SegmentMatchRow[]> {
  const rows = toSegmentMatchRows(params);
  return db.transaction(async (tx) => {
    await tx
      .delete(segmentMatches)
      .where(
        and(
          eq(segmentMatches.projectId, params.projectId),
          eq(segmentMatches.ranker, params.ranker),
          eq(segmentMatches.rankerVersion, params.rankerVersion),
        ),
      );
    if (rows.length === 0) return [];
    return tx.insert(segmentMatches).values(rows).returning();
  });
}

export function listSegmentMatches(db: Database, projectId: string): Promise<SegmentMatchRow[]> {
  return db.query.segmentMatches.findMany({
    where: eq(segmentMatches.projectId, projectId),
  });
}
