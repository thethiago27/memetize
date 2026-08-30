import type { JobRegistry } from '@memetize/orchestrator';
import { createSceneDetectHandler } from '@memetize/scene-detector';
import { createNormalizeHandler } from '@memetize/video-normalizer';

/**
 * Composition root for job handlers. The CLI wires domain handlers to job types;
 * the orchestrator itself stays generic (spec section 79).
 */
export function buildRegistry(): JobRegistry {
  return {
    PING: async (ctx) => ({
      pong: true,
      at: new Date().toISOString(),
      entityId: ctx.job.entityId,
    }),
    VIDEO_NORMALIZE: createNormalizeHandler(),
    SCENE_DETECT: createSceneDetectHandler(),
  };
}
