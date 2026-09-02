import type { FeedbackPolarity } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import { mediaAssets, momentFeedbackEmbeddings, moments } from '@memetize/database';
import { and, asc, cosineDistance, eq } from 'drizzle-orm';
import { exclusionConditions, type QueryVector, type SearchExclusions } from './search';

export interface FeedbackHit {
  momentId: string;
  assetId: string;
  feedbackEventId: string;
  score: number;
}

export interface SearchFeedbackParams {
  query: QueryVector;
  polarity: FeedbackPolarity;
  limit?: number;
  exclude?: SearchExclusions;
}

const DEFAULT_LIMIT = 20;

/**
 * Searches what past swaps taught (editorial-memory spec): POSITIVE vectors
 * surface moments the editor chose for segments like the query, NEGATIVE
 * vectors flag moments the editor rejected from such segments. Same model
 * filter and READY-asset rule as the catalog index.
 */
export async function searchFeedbackMoments(
  db: Database,
  params: SearchFeedbackParams,
): Promise<FeedbackHit[]> {
  const limit = params.limit ?? DEFAULT_LIMIT;
  const distance = cosineDistance(momentFeedbackEmbeddings.embedding, params.query.vector);

  const rows = await db
    .select({
      momentId: momentFeedbackEmbeddings.momentId,
      assetId: momentFeedbackEmbeddings.assetId,
      feedbackEventId: momentFeedbackEmbeddings.feedbackEventId,
      distance,
    })
    .from(momentFeedbackEmbeddings)
    .innerJoin(moments, eq(momentFeedbackEmbeddings.momentId, moments.id))
    .innerJoin(mediaAssets, eq(moments.assetId, mediaAssets.id))
    .where(
      and(
        eq(momentFeedbackEmbeddings.polarity, params.polarity),
        eq(momentFeedbackEmbeddings.model, params.query.model),
        eq(momentFeedbackEmbeddings.modelVersion, params.query.modelVersion),
        eq(mediaAssets.status, 'READY'),
        ...exclusionConditions(params.exclude),
      ),
    )
    .orderBy(asc(distance))
    .limit(limit);

  return rows.map((row) => ({
    momentId: row.momentId,
    assetId: row.assetId,
    feedbackEventId: row.feedbackEventId,
    score: Math.max(0, Math.min(1, 1 - Number(row.distance))),
  }));
}
