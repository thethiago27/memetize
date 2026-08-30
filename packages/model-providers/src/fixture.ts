import { MOMENTS_PROMPT_VERSION, VISION_PROMPT_VERSION } from '@memetize/prompts';
import type {
  LLMProvider,
  MomentSuggestInput,
  MomentSuggestResult,
  VisionAnalyzeInput,
  VisionAnalyzeResult,
  VisionProvider,
} from './types';

const FIXTURE_NAME = 'fixture';
const FIXTURE_VERSION = '1.0.0';

/**
 * Deterministic vision provider used by default and in tests (spec section
 * 66): no GPU or API call, but the output still respects the structured
 * schema (spec section 19) so downstream persistence and moment extraction
 * are exercised end-to-end without external dependencies.
 */
export class FixtureVisionProvider implements VisionProvider {
  readonly name = FIXTURE_NAME;

  async analyze(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    const hasSpeech = input.transcript.length > 0;
    const result = {
      summary: `Scene with ${input.frames.length} sampled frame(s)${hasSpeech ? ' and speech' : ''}.`,
      subjects: [],
      actions: hasSpeech ? ['speaking'] : [],
      emotionTrajectory: [],
      visualEnergy: 0.5,
      camera: { movement: 'static', shotType: 'unknown' },
      memeFunctions: ['unclassified'],
      quality: { usable: true, score: 0.5 },
    };
    return {
      result,
      model: FIXTURE_NAME,
      modelVersion: FIXTURE_VERSION,
      promptVersion: VISION_PROMPT_VERSION,
      raw: result,
    };
  }
}

/**
 * Deterministic moment suggester: one moment per scene, spanning its full
 * bounds. The MVP extractor must not block on perfect boundaries (spec
 * section 22); refinement (optical flow, face changes, ...) comes later.
 */
export class FixtureLLMProvider implements LLMProvider {
  readonly name = FIXTURE_NAME;

  async suggestMoments(input: MomentSuggestInput): Promise<MomentSuggestResult> {
    const [firstEmotion] = input.vision.emotionTrajectory;
    return {
      moments: [
        {
          startMs: input.startMs,
          endMs: input.endMs,
          description: input.vision.summary,
          primaryEmotion: firstEmotion?.emotion ?? null,
          emotionIntensity: firstEmotion?.intensity ?? null,
          visualEnergy: input.vision.visualEnergy,
          qualityScore: input.vision.quality.score,
          metadata: { memeFunctions: input.vision.memeFunctions },
        },
      ],
      extractor: FIXTURE_NAME,
      extractorVersion: FIXTURE_VERSION,
      promptVersion: MOMENTS_PROMPT_VERSION,
    };
  }
}
