import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type EmbeddingType, EmbedInput, type VisionSceneAnalysis } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import {
  buildEmbeddingTexts,
  EMBEDDING_TYPES,
  type EmbeddingVectorInput,
  embeddingDebugFile,
  getScene,
  listMoments,
  replaceEmbeddings,
  setAssetStatus,
} from '@memetize/media-catalog';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';
import { ensureDir } from '@memetize/shared';

interface PendingEmbedding {
  momentId: string;
  embeddingType: EmbeddingType;
  sourceText: string;
}

/**
 * EMBED handler (spec sections 23, 40): turns each moment into three
 * vectors (VISUAL/MEME/NARRATIVE) via the configured `EmbeddingProvider`,
 * persists them, and closes out the catalog pipeline by marking the asset
 * `READY` once every moment has all three. An asset with no moments is a
 * valid, successful empty run — it just never reaches `READY`.
 */
export function createEmbedHandler(): JobHandler {
  return async (ctx) => {
    const parsed = EmbedInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { assetId } = parsed.data;

    const moments = await listMoments(ctx.db, assetId);
    const { embedding: provider } = createProviders(ctx.config);

    if (moments.length === 0) {
      ctx.logger.info('embed_completed_empty', { assetId });
      return { assetId, embeddingCount: 0, model: provider.name, modelVersion: '' };
    }

    // Cache scene *vision* by sceneId (fetched once per scene); the derived
    // texts still depend on each moment's own description/metadata, so those
    // are built per moment, not cached alongside the scene.
    const sceneVisionCache = new Map<string, VisionSceneAnalysis | null>();
    const pending: PendingEmbedding[] = [];
    const textsByMoment = new Map<string, Record<EmbeddingType, string>>();

    for (const moment of moments) {
      let vision = sceneVisionCache.get(moment.sceneId);
      if (vision === undefined) {
        const scene = await getScene(ctx.db, moment.sceneId);
        vision = scene?.vision ?? null;
        sceneVisionCache.set(moment.sceneId, vision);
      }
      const texts = buildEmbeddingTexts(
        {
          description: moment.description,
          primaryEmotion: moment.primaryEmotion,
          metadata: moment.metadata,
        },
        vision,
      );
      textsByMoment.set(moment.id, texts);
      for (const embeddingType of EMBEDDING_TYPES) {
        pending.push({ momentId: moment.id, embeddingType, sourceText: texts[embeddingType] });
      }
    }

    let model = provider.name;
    let modelVersion = '';
    let vectors: number[][];
    try {
      const result = await provider.embed(pending.map((item) => item.sourceText));
      vectors = result.vectors;
      model = result.model;
      modelVersion = result.modelVersion;
    } catch (error) {
      throw new JobFailure(
        'EMBED_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    const embeddings: EmbeddingVectorInput[] = [];
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const vector = vectors[i];
      if (!item || !vector) {
        throw new JobFailure(
          'EMBED_ERROR',
          'embedding provider returned a mismatched vector count',
          false,
        );
      }
      embeddings.push({
        momentId: item.momentId,
        assetId,
        embeddingType: item.embeddingType,
        sourceText: item.sourceText,
        vector,
      });
    }

    const persisted = await replaceEmbeddings(ctx.db, { assetId, model, modelVersion, embeddings });

    for (const [momentId, texts] of textsByMoment) {
      const debugFile = embeddingDebugFile(ctx.config, assetId, momentId);
      await ensureDir(dirname(debugFile.absolute));
      await writeFile(
        debugFile.absolute,
        JSON.stringify(
          { momentId, texts, model, modelVersion, dimensions: ctx.config.embeddingDimensions },
          null,
          2,
        ),
      );
    }

    // READY only once every moment has all three embeddings (spec section 40).
    if (persisted.length === moments.length * EMBEDDING_TYPES.length) {
      await setAssetStatus(ctx.db, assetId, 'READY');
    }

    ctx.logger.info('embed_completed', {
      assetId,
      embeddingCount: persisted.length,
      model,
      modelVersion,
    });
    return { assetId, embeddingCount: persisted.length, model, modelVersion };
  };
}
