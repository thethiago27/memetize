import type { EmbeddingType } from '@memetize/contracts';
import { SearchHit } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import { mediaAssets, momentEmbeddings, moments } from '@memetize/database';
import { createProviders } from '@memetize/model-providers';
import type { AppConfig } from '@memetize/shared';
import { and, asc, cosineDistance, eq } from 'drizzle-orm';

export interface SearchParams {
  query: string;
  /** Which angle to match against (spec section 23). Defaults to `MEME`,
   * the retrieval type described by the spec (section 28). */
  type?: EmbeddingType;
  limit?: number;
}

const DEFAULT_TYPE: EmbeddingType = 'MEME';
const DEFAULT_LIMIT = 20;

/**
 * Candidate Retriever (spec section 28): embeds `query` with the same
 * provider/dimension as the index, then ranks moments by cosine distance.
 * Only compares against vectors from the same `(model, modelVersion)` as the
 * query embedding, and only against `READY` assets, since a partially
 * indexed asset may not have every moment embedded yet.
 */
export async function searchMoments(
  db: Database,
  config: AppConfig,
  params: SearchParams,
): Promise<SearchHit[]> {
  const { embedding: provider } = createProviders(config);
  const { vectors, model, modelVersion } = await provider.embed([params.query]);
  const queryVector = vectors[0];
  if (!queryVector) {
    throw new Error('embedding provider returned no vector for the search query');
  }

  const type = params.type ?? DEFAULT_TYPE;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const distance = cosineDistance(momentEmbeddings.embedding, queryVector);

  const rows = await db
    .select({
      momentId: moments.id,
      assetId: moments.assetId,
      startMs: moments.startMs,
      endMs: moments.endMs,
      description: moments.description,
      distance,
    })
    .from(momentEmbeddings)
    .innerJoin(moments, eq(momentEmbeddings.momentId, moments.id))
    .innerJoin(mediaAssets, eq(moments.assetId, mediaAssets.id))
    .where(
      and(
        eq(momentEmbeddings.embeddingType, type),
        eq(momentEmbeddings.model, model),
        eq(momentEmbeddings.modelVersion, modelVersion),
        eq(mediaAssets.status, 'READY'),
      ),
    )
    .orderBy(asc(distance))
    .limit(limit);

  return rows.map((row) =>
    SearchHit.parse({
      momentId: row.momentId,
      assetId: row.assetId,
      startMs: row.startMs,
      endMs: row.endMs,
      description: row.description,
      score: 1 - Number(row.distance),
    }),
  );
}
