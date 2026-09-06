import type { EmbeddingType } from '@memetize/contracts';
import { SearchHit } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import { mediaAssets, momentEmbeddings, moments } from '@memetize/database';
import { createProviders } from '@memetize/model-providers';
import type { AppConfig } from '@memetize/shared';
import { and, asc, cosineDistance, eq, gte, notInArray, type SQL } from 'drizzle-orm';

/** Moments and assets to leave out of a search (editorial-memory bans). */
export interface SearchExclusions {
  momentIds?: Iterable<string>;
  assetIds?: Iterable<string>;
}

export interface SearchParams {
  query: string;
  /** Which angle to match against (spec section 23). Defaults to `MEME`,
   * the retrieval type described by the spec (section 28). */
  type?: EmbeddingType;
  limit?: number;
  exclude?: SearchExclusions;
}

export interface QueryVector {
  vector: number[];
  model: string;
  modelVersion: string;
}

const DEFAULT_TYPE: EmbeddingType = 'MEME';
const DEFAULT_LIMIT = 20;

/** Embeds one query with the configured provider so several indexes can share the vector. */
export async function embedQuery(config: AppConfig, query: string): Promise<QueryVector> {
  const { embedding: provider } = createProviders(config);
  const { vectors, model, modelVersion } = await provider.embed([query]);
  const vector = vectors[0];
  if (!vector) {
    throw new Error('embedding provider returned no vector for the search query');
  }
  return { vector, model, modelVersion };
}

/** WHERE fragments for bans; both indexes join `moments`, so its columns apply to either. */
export function exclusionConditions(exclude: SearchExclusions | undefined): SQL[] {
  const conditions: SQL[] = [];
  const momentIds = [...(exclude?.momentIds ?? [])];
  const assetIds = [...(exclude?.assetIds ?? [])];
  if (momentIds.length > 0) conditions.push(notInArray(moments.id, momentIds));
  if (assetIds.length > 0) conditions.push(notInArray(moments.assetId, assetIds));
  return conditions;
}

export interface SearchByVectorParams {
  query: QueryVector;
  type?: EmbeddingType;
  limit?: number;
  exclude?: SearchExclusions;
  /** Only moments at least this long (ms): the coverage pass for short segments. */
  minDurationMs?: number;
}

/**
 * Candidate Retriever (spec section 28) against the catalog index: ranks
 * moments by cosine distance to an already-embedded query. Only compares
 * against vectors from the same `(model, modelVersion)` as the query
 * embedding, and only against `READY` assets, since a partially indexed
 * asset may not have every moment embedded yet.
 */
export async function searchMomentsByVector(
  db: Database,
  params: SearchByVectorParams,
): Promise<SearchHit[]> {
  const type = params.type ?? DEFAULT_TYPE;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const distance = cosineDistance(momentEmbeddings.embedding, params.query.vector);

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
        eq(momentEmbeddings.model, params.query.model),
        eq(momentEmbeddings.modelVersion, params.query.modelVersion),
        eq(mediaAssets.status, 'READY'),
        ...(params.minDurationMs !== undefined
          ? [gte(moments.durationMs, params.minDurationMs)]
          : []),
        ...exclusionConditions(params.exclude),
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
      // Clamped like the feedback index: both feed the same ranker, and
      // `SearchHit` documents scores as plain numbers in [0, 1]. A cosine
      // distance can round just outside it.
      score: Math.max(0, Math.min(1, 1 - Number(row.distance))),
    }),
  );
}

/** Embeds `query` then searches the catalog index; the `search` CLI/API entry point. */
export async function searchMoments(
  db: Database,
  config: AppConfig,
  params: SearchParams,
): Promise<SearchHit[]> {
  const query = await embedQuery(config, params.query);
  return searchMomentsByVector(db, {
    query,
    type: params.type,
    limit: params.limit,
    exclude: params.exclude,
  });
}
