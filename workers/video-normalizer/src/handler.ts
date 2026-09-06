import { NormalizeInput } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import {
  assetFile,
  resolveStorage,
  setAssetStatus,
  updateAssetDerived,
} from '@memetize/media-catalog';
import type { JobHandler } from '@memetize/orchestrator';
import { normalizeVideo } from './normalize';

/**
 * VIDEO_NORMALIZE handler: produce proxy/analysis/thumbnail, record their paths,
 * move the asset to ANALYZING, then chain SCENE_DETECT on the analysis video.
 */
export function createNormalizeHandler(): JobHandler {
  return async (ctx) => {
    const parsed = NormalizeInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { assetId } = parsed.data;
    const original = resolveStorage(ctx.config, parsed.data.originalPath);

    const proxy = assetFile(ctx.config, assetId, 'proxy.mp4');
    const analysis = assetFile(ctx.config, assetId, 'analysis.mp4');
    const thumbnail = assetFile(ctx.config, assetId, 'thumbnail.jpg');

    await ctx.progress(async ({ tx }) => setAssetStatus(tx, assetId, 'NORMALIZING'));
    try {
      await normalizeVideo({
        originalPath: original,
        proxyPath: proxy.absolute,
        analysisPath: analysis.absolute,
        thumbnailPath: thumbnail.absolute,
      });
    } catch (error) {
      // FAILED is propagated to the asset by the orchestrator's onJobFailed hook,
      // which checks the generation is still current first (F08/F09).
      throw new JobFailure(
        'VIDEO_NORMALIZE_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    // Derived paths, ANALYZING and the SCENE_DETECT follow-up commit together
    // with the job completion (F10), only while this attempt owns the job and its
    // generation is current (F08/F09).
    const result = await ctx.publish(async ({ tx, enqueue }) => {
      await updateAssetDerived(tx, assetId, {
        proxyPath: proxy.relative,
        analysisPath: analysis.relative,
        thumbnailPath: thumbnail.relative,
      });
      await setAssetStatus(tx, assetId, 'ANALYZING');
      await enqueue({
        type: 'SCENE_DETECT',
        entityId: assetId,
        input: { assetId, analysisPath: analysis.relative },
      });
      return {
        proxyPath: proxy.relative,
        analysisPath: analysis.relative,
        thumbnailPath: thumbnail.relative,
      };
    });

    ctx.logger.info('normalize_completed', {
      proxyPath: proxy.relative,
      analysisPath: analysis.relative,
    });

    return result;
  };
}
