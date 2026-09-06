import { FrameExtractInput } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { frameFile, listScenes, resolveStorage, updateSceneFrames } from '@memetize/media-catalog';
import type { JobHandler } from '@memetize/orchestrator';
import { extractFrame } from './extract';
import { sampleFrameTimestamps } from './sample';

/**
 * FRAME_EXTRACT handler: samples frames per scene from `analysis.mp4`,
 * persists them on the scene row, then signals the frames/transcript
 * barrier (spec sections 12 and 18).
 */
export function createFrameExtractHandler(): JobHandler {
  return async (ctx) => {
    const parsed = FrameExtractInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { assetId, analysisPath } = parsed.data;
    const analysisAbsolute = resolveStorage(ctx.config, analysisPath);

    const scenes = await listScenes(ctx.db, assetId);
    let frameCount = 0;
    const extracted: { sceneId: string; frames: { timestampMs: number; path: string }[] }[] = [];
    try {
      for (const scene of scenes) {
        const timestamps = sampleFrameTimestamps(scene);
        const frames: { timestampMs: number; path: string }[] = [];
        for (const timestampMs of timestamps) {
          const file = frameFile(ctx.config, assetId, scene.id, timestampMs);
          await extractFrame({
            videoPath: analysisAbsolute,
            timestampMs,
            outputPath: file.absolute,
          });
          frames.push({ timestampMs, path: file.relative });
        }
        extracted.push({ sceneId: scene.id, frames });
        frameCount += frames.length;
      }
    } catch (error) {
      throw new JobFailure(
        'FRAME_EXTRACT_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    // Every scene's frames commit together with the job completion, only while
    // this attempt still owns the lease and its generation is current (F08/F09).
    // VISION_ANALYZE fan-in is enqueued from the orchestrator's post-completion hook (F10).
    const published = await ctx.publish(async ({ tx }) => {
      for (const scene of extracted) {
        await updateSceneFrames(tx, scene.sceneId, scene.frames);
      }
      return { sceneCount: scenes.length, frameCount };
    });

    ctx.logger.info('frame_extract_completed', { sceneCount: scenes.length, frameCount });
    return published;
  };
}
