import type { FeedbackPolarity } from '@memetize/contracts';
import {
  type Executor,
  type MomentFeedbackEmbeddingRow,
  momentFeedbackEmbeddings,
} from '@memetize/database';
import { feedbackEmbeddingId } from '@memetize/shared';
import { asc, eq, sql } from 'drizzle-orm';

export interface UpsertFeedbackEmbeddingParams {
  feedbackEventId: string;
  momentId: string;
  assetId: string;
  polarity: FeedbackPolarity;
  sourceText: string;
  vector: number[];
  model: string;
  modelVersion: string;
}

/** Idempotent on `(feedbackEventId, model, modelVersion)` so a re-run FEEDBACK_EMBED job replaces, never duplicates. */
export async function upsertFeedbackEmbedding(
  db: Executor,
  params: UpsertFeedbackEmbeddingParams,
): Promise<MomentFeedbackEmbeddingRow> {
  const [row] = await db
    .insert(momentFeedbackEmbeddings)
    .values({
      id: feedbackEmbeddingId(),
      feedbackEventId: params.feedbackEventId,
      momentId: params.momentId,
      assetId: params.assetId,
      polarity: params.polarity,
      sourceText: params.sourceText,
      embedding: params.vector,
      model: params.model,
      modelVersion: params.modelVersion,
    })
    .onConflictDoUpdate({
      target: [
        momentFeedbackEmbeddings.feedbackEventId,
        momentFeedbackEmbeddings.model,
        momentFeedbackEmbeddings.modelVersion,
      ],
      set: {
        embedding: params.vector,
        sourceText: params.sourceText,
        polarity: params.polarity,
        createdAt: sql`now()`,
      },
    })
    .returning();
  if (!row) throw new Error('failed to upsert feedback embedding');
  return row;
}

export function listFeedbackEmbeddingsForMoment(
  db: Executor,
  momentId: string,
): Promise<MomentFeedbackEmbeddingRow[]> {
  return db.query.momentFeedbackEmbeddings.findMany({
    where: eq(momentFeedbackEmbeddings.momentId, momentId),
    orderBy: asc(momentFeedbackEmbeddings.createdAt),
  });
}
