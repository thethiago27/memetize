import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { VisionInput, VisionSceneAnalysis } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import {
  listScenes,
  listTranscriptSegments,
  updateSceneVision,
  visionDebugFile,
} from '@memetize/media-catalog';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';
import { ensureDir } from '@memetize/shared';
import { overlaps } from './overlap';

/**
 * VISION_ANALYZE handler: interprets each scene at two levels (spec section
 * 19) using the configured `VisionProvider`, persists the structured result,
 * keeps a debug snapshot (spec section 64), then chains MOMENT_EXTRACT.
 */
export function createVisionAnalyzeHandler(): JobHandler {
  return async (ctx) => {
    const parsed = VisionInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { assetId } = parsed.data;

    const scenes = await listScenes(ctx.db, assetId);
    const transcript = await listTranscriptSegments(ctx.db, assetId);
    const { vision: provider } = createProviders(ctx.config);

    let model = provider.name;
    let modelVersion = '';
    let promptVersion = '';

    try {
      for (const scene of scenes) {
        const sceneTranscript = transcript
          .filter((segment) => overlaps(scene, segment))
          .map((segment) => ({
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
          }));

        const analysis = await provider.analyze({
          sceneId: scene.id,
          startMs: scene.startMs,
          endMs: scene.endMs,
          frames: scene.frames,
          transcript: sceneTranscript,
        });
        const result = VisionSceneAnalysis.parse(analysis.result);

        await updateSceneVision(ctx.db, scene.id, {
          vision: result,
          visionModel: analysis.model,
          visionVersion: analysis.modelVersion,
        });

        model = analysis.model;
        modelVersion = analysis.modelVersion;
        promptVersion = analysis.promptVersion;

        const debugFile = visionDebugFile(ctx.config, assetId, scene.id);
        await ensureDir(dirname(debugFile.absolute));
        await writeFile(
          debugFile.absolute,
          JSON.stringify(
            {
              sceneId: scene.id,
              frames: scene.frames,
              transcript: sceneTranscript,
              promptVersion: analysis.promptVersion,
              model: analysis.model,
              modelVersion: analysis.modelVersion,
              raw: analysis.raw,
              parsed: result,
            },
            null,
            2,
          ),
        );
      }
    } catch (error) {
      throw new JobFailure(
        'VISION_ANALYZE_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    await ctx.enqueue({ type: 'MOMENT_EXTRACT', entityId: assetId, input: { assetId } });

    ctx.logger.info('vision_analyze_completed', {
      sceneCount: scenes.length,
      model,
      modelVersion,
    });
    return { sceneCount: scenes.length, model, modelVersion, promptVersion };
  };
}
