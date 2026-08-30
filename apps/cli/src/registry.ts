import { createAudioAnalyzeHandler } from '@memetize/audio-analyzer';
import { createEmbedHandler } from '@memetize/embedding';
import { createFrameExtractHandler } from '@memetize/frame-extractor';
import { createLyricsHandler } from '@memetize/lyrics';
import { createMomentExtractHandler } from '@memetize/moment-extractor';
import { createNarrativeHandler } from '@memetize/narrative-analyzer';
import type { JobRegistry } from '@memetize/orchestrator';
import { createSceneDetectHandler } from '@memetize/scene-detector';
import { createTranscriptHandler } from '@memetize/transcript';
import { createNormalizeHandler } from '@memetize/video-normalizer';
import { createVisionAnalyzeHandler } from '@memetize/vision-analyzer';

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
    FRAME_EXTRACT: createFrameExtractHandler(),
    TRANSCRIPT: createTranscriptHandler(),
    VISION_ANALYZE: createVisionAnalyzeHandler(),
    MOMENT_EXTRACT: createMomentExtractHandler(),
    EMBED: createEmbedHandler(),
    AUDIO_ANALYZE: createAudioAnalyzeHandler(),
    LYRICS: createLyricsHandler(),
    NARRATIVE: createNarrativeHandler(),
  };
}
