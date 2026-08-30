import { fileURLToPath } from 'node:url';
import { SceneDetectInput, SceneDetectionOutput, WorkerResult } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { getAsset, replaceScenes, resolveStorage } from '@memetize/media-catalog';
import type { JobHandler } from '@memetize/orchestrator';
import { runPythonWorker } from '@memetize/shared';

/** Python project root (this file lives at workers/scene-detector/src/handler.ts). */
export const SCENE_DETECTOR_DIR = fileURLToPath(new URL('..', import.meta.url));

const TIMEOUT_MS = 120_000;

/**
 * SCENE_DETECT handler: spawns the Python worker over the stdin/stdout protocol,
 * validates its output against the contract, and persists integer-ms scenes.
 */
export function createSceneDetectHandler(): JobHandler {
  return async (ctx) => {
    const parsed = SceneDetectInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { assetId } = parsed.data;
    const analysisAbsolute = resolveStorage(ctx.config, parsed.data.analysisPath);

    let stdout: string;
    try {
      ({ stdout } = await runPythonWorker({
        cwd: SCENE_DETECTOR_DIR,
        module: 'scene_detector',
        request: {
          jobId: ctx.job.id,
          entityId: assetId,
          workerVersion: ctx.job.workerVersion,
          input: { assetId, analysisPath: analysisAbsolute },
        },
        timeoutMs: TIMEOUT_MS,
      }));
    } catch (error) {
      throw new JobFailure(
        'SCENE_DETECT_SPAWN_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(stdout);
    } catch (error) {
      throw new JobFailure(
        'SCENE_DETECT_BAD_OUTPUT',
        `stdout was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }

    const resultParse = WorkerResult.safeParse(raw);
    if (!resultParse.success) {
      throw new JobFailure('SCENE_DETECT_BAD_OUTPUT', resultParse.error.message, false);
    }
    const result = resultParse.data;
    if (result.status === 'failed') {
      throw new JobFailure(result.error.code, result.error.message, result.error.retryable);
    }

    const outputParse = SceneDetectionOutput.safeParse(result.output);
    if (!outputParse.success) {
      throw new JobFailure('SCENE_DETECT_BAD_OUTPUT', outputParse.error.message, false);
    }
    const output = outputParse.data;

    const persisted = await replaceScenes(ctx.db, {
      assetId,
      detector: output.detector,
      detectorVersion: output.detectorVersion,
      scenes: output.scenes,
    });

    // Fan-out (spec section 12): frames and transcript run independently;
    // vision analysis waits for both via the barrier in media-catalog.
    const asset = await getAsset(ctx.db, assetId);
    if (!asset) {
      throw new JobFailure('ASSET_NOT_FOUND', `asset not found: ${assetId}`, false);
    }
    await ctx.enqueue({
      type: 'FRAME_EXTRACT',
      entityId: assetId,
      input: { assetId, analysisPath: parsed.data.analysisPath },
    });
    await ctx.enqueue({
      type: 'TRANSCRIPT',
      entityId: assetId,
      input: { assetId, originalPath: asset.originalPath },
    });

    ctx.logger.info('scene_detection_persisted', { sceneCount: persisted.length });
    return {
      sceneCount: persisted.length,
      detector: output.detector,
      detectorVersion: output.detectorVersion,
    };
  };
}
