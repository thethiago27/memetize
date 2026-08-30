import type { EmbeddingType, VisionSceneAnalysis } from '@memetize/contracts';
import {
  type Database,
  type MomentEmbeddingRow,
  momentEmbeddings,
  type NewMomentEmbeddingRow,
} from '@memetize/database';
import { embeddingId } from '@memetize/shared';
import { and, asc, eq } from 'drizzle-orm';

/** The three angles every moment is embedded from (spec section 23). */
export const EMBEDDING_TYPES: readonly EmbeddingType[] = ['VISUAL', 'MEME', 'NARRATIVE'];

export interface MomentForEmbedding {
  description: string;
  primaryEmotion: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Derives the three embedding source texts for a moment from what Phase 2
 * already persisted — no LLM call, no new prompt (spec section 4.1: the
 * Embedding Worker embeds, it does not reinterpret).
 */
export function buildEmbeddingTexts(
  moment: MomentForEmbedding,
  vision: VisionSceneAnalysis | null,
): Record<EmbeddingType, string> {
  const subjects = vision?.subjects.map((subject) => subject.description) ?? [];
  const actions = vision?.actions ?? [];
  const memeFunctions =
    (Array.isArray(moment.metadata.memeFunctions)
      ? (moment.metadata.memeFunctions as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : null) ??
    vision?.memeFunctions ??
    [];

  const visual =
    [
      vision?.summary,
      subjects.length > 0 ? `Subjects: ${subjects.join(', ')}.` : null,
      actions.length > 0 ? `Actions: ${actions.join(', ')}.` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' ') || 'No visual description available.';

  const meme =
    [
      moment.description,
      memeFunctions.length > 0 ? `Meme functions: ${memeFunctions.join(', ')}.` : null,
      moment.primaryEmotion ? `Primary emotion: ${moment.primaryEmotion}.` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' ') || moment.description;

  const narrativeFunction = memeFunctions[0] ?? actions[0] ?? 'the setup';
  const narrative = `Reaction after ${narrativeFunction}.`;

  return { VISUAL: visual, MEME: meme, NARRATIVE: narrative };
}

export interface EmbeddingVectorInput {
  momentId: string;
  assetId: string;
  embeddingType: EmbeddingType;
  sourceText: string;
  vector: number[];
}

export interface ReplaceEmbeddingsParams {
  assetId: string;
  model: string;
  modelVersion: string;
  embeddings: EmbeddingVectorInput[];
}

/** Pure builder, mirrors `toMomentRows`. */
export function toEmbeddingRows(params: ReplaceEmbeddingsParams): NewMomentEmbeddingRow[] {
  return params.embeddings.map((input) => ({
    id: embeddingId(),
    momentId: input.momentId,
    assetId: params.assetId,
    embeddingType: input.embeddingType,
    sourceText: input.sourceText,
    embedding: input.vector,
    model: params.model,
    modelVersion: params.modelVersion,
  }));
}

/**
 * Idempotently persists embeddings: existing rows for that asset/model
 * combination are replaced, so re-running the Embedding Worker never
 * duplicates vectors (spec section 4.2).
 */
export async function replaceEmbeddings(
  db: Database,
  params: ReplaceEmbeddingsParams,
): Promise<MomentEmbeddingRow[]> {
  const rows = toEmbeddingRows(params);
  return db.transaction(async (tx) => {
    await tx
      .delete(momentEmbeddings)
      .where(
        and(
          eq(momentEmbeddings.assetId, params.assetId),
          eq(momentEmbeddings.model, params.model),
          eq(momentEmbeddings.modelVersion, params.modelVersion),
        ),
      );
    if (rows.length === 0) return [];
    return tx.insert(momentEmbeddings).values(rows).returning();
  });
}

export function listEmbeddingsForAsset(
  db: Database,
  assetId: string,
): Promise<MomentEmbeddingRow[]> {
  return db.query.momentEmbeddings.findMany({
    where: eq(momentEmbeddings.assetId, assetId),
    orderBy: asc(momentEmbeddings.createdAt),
  });
}
