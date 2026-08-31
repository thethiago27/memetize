import { createAudioAnalyzeHandler } from '@memetize/audio-analyzer';
import { createDirectorHandler } from '@memetize/director-worker';
import { createEffectsHandler } from '@memetize/effects-worker';
import { createEmbedHandler } from '@memetize/embedding';
import { createFrameExtractHandler } from '@memetize/frame-extractor';
import { createLyricsHandler } from '@memetize/lyrics';
import { createMatchHandler } from '@memetize/matching';
import { createMomentExtractHandler } from '@memetize/moment-extractor';
import { createNarrativeHandler } from '@memetize/narrative-analyzer';
import type { JobRegistry } from '@memetize/orchestrator';
import { createRenderHandler } from '@memetize/renderer-worker';
import { createSceneDetectHandler } from '@memetize/scene-detector';
import { createTimingHandler } from '@memetize/timing-worker';
import { createTranscriptHandler } from '@memetize/transcript';
import { createNormalizeHandler } from '@memetize/video-normalizer';
import { createVisionAnalyzeHandler } from '@memetize/vision-analyzer';

/**
 * Composition root for job handlers (spec section 79). Shared by the CLI
 * and the HTTP API so both talk to the same Orchestrator wiring.
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
    MATCH: createMatchHandler(),
    DIRECTOR: createDirectorHandler(),
    TIMING: createTimingHandler(),
    EFFECTS: createEffectsHandler(),
    RENDER: createRenderHandler(),
  };
}
