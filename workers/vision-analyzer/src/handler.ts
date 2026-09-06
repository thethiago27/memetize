import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { VisionInput, VisionSceneAnalysis } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import {
  listScenes,
  listTranscriptSegments,
  resolveStorage,
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

    /** One scene's analysis, held until the publication writes them together. */
    interface AnalyzedScene {
      sceneId: string;
      vision: VisionSceneAnalysis;
      visionModel: string;
      visionVersion: string;
      debug: Record<string, unknown>;
    }
    const analyzed: AnalyzedScene[] = [];

    try {
      for (const scene of scenes) {
        const sceneTranscript = transcript
          .filter((segment) => overlaps(scene, segment))
          .map((segment) => ({
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
          }));

        // Frame paths are stored repo-relative; resolve them here so the provider
        // reads the right file from any working directory (F01).
        const analysis = await provider.analyze({
          sceneId: scene.id,
          startMs: scene.startMs,
          endMs: scene.endMs,
          frames: scene.frames.map((frame) => ({
            ...frame,
            path: resolveStorage(ctx.config, frame.path),
          })),
          transcript: sceneTranscript,
        });
        const result = VisionSceneAnalysis.parse(analysis.result);

        model = analysis.model;
        modelVersion = analysis.modelVersion;
        promptVersion = analysis.promptVersion;

        analyzed.push({
          sceneId: scene.id,
          vision: result,
          visionModel: analysis.model,
          visionVersion: analysis.modelVersion,
          debug: {
            sceneId: scene.id,
            frames: scene.frames,
            transcript: sceneTranscript,
            promptVersion: analysis.promptVersion,
            model: analysis.model,
            modelVersion: analysis.modelVersion,
            raw: analysis.raw,
            parsed: result,
          },
        });
      }
    } catch (error) {
      throw new JobFailure(
        'VISION_ANALYZE_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    // Every scene's analysis and the MOMENT_EXTRACT follow-up commit with the
    // job completion (F10), only while this attempt owns the job and its
    // generation is current (F08/F09) — a partially analyzed asset is never left
    // behind by an attempt that lost its lease.
    const result = await ctx.publish(async ({ tx, enqueue }) => {
      for (const scene of analyzed) {
        await updateSceneVision(tx, scene.sceneId, {
          vision: scene.vision,
          visionModel: scene.visionModel,
          visionVersion: scene.visionVersion,
        });
      }
      await enqueue({ type: 'MOMENT_EXTRACT', entityId: assetId, input: { assetId } });
      return { sceneCount: scenes.length, model, modelVersion, promptVersion };
    });

    for (const scene of analyzed) {
      const debugFile = visionDebugFile(ctx.config, assetId, scene.sceneId);
      await ensureDir(dirname(debugFile.absolute));
      await writeFile(debugFile.absolute, JSON.stringify(scene.debug, null, 2));
    }

    ctx.logger.info('vision_analyze_completed', {
      sceneCount: scenes.length,
      model,
      modelVersion,
    });
    return result;
  };
}
