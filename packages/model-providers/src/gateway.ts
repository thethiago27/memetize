import { DirectorPick } from '@memetize/contracts';
import {
  DIRECTOR_PROMPT_V4,
  DIRECTOR_PROMPT_VERSION,
  MOMENTS_PROMPT_V1,
  MOMENTS_PROMPT_VERSION,
  NARRATIVE_PROMPT_V2,
  NARRATIVE_PROMPT_VERSION,
} from '@memetize/prompts';
import { generateObject } from 'ai';
import { z } from 'zod';
import type {
  DirectTimelineInput,
  DirectTimelineResult,
  LLMProvider,
  MomentSuggestInput,
  MomentSuggestResult,
  NarrativeAnalyzeInput,
  NarrativeAnalyzeResult,
} from './types';

const GATEWAY_NAME = 'gateway';
const GATEWAY_VERSION = '1.0.0';

/**
 * Provenance version for a gateway-backed result (F01): the adapter version plus
 * the exact model id, so narrative segments, moments and timelines record which
 * model produced them, not just "gateway".
 */
export function gatewayModelVersion(model: string): string {
  return `${GATEWAY_VERSION}/${model}`;
}

/**
 * Exported so tests can pin the exact contract the model is held to: cut
 * styles are closed enums with defaults, so an omitted style is fine and
 * an invented one fails the structured-output parse.
 */
export const DirectorPicksSchema = z.object({
  picks: z.array(DirectorPick),
});

const MomentsSchema = z.object({
  moments: z.array(
    z.object({
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().nonnegative(),
      description: z.string(),
      primaryEmotion: z.string().nullable().default(null),
      emotionIntensity: z.number().min(0).max(1).nullable().default(null),
      visualEnergy: z.number().min(0).max(1).nullable().default(null),
      qualityScore: z.number().min(0).max(1).nullable().default(null),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
});

const NarrativeSchema = z.object({
  segments: z.array(
    z.object({
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().nonnegative(),
      lyrics: z.string(),
      meaning: z.string(),
      emotion: z.string(),
      narrativeFunction: z.string(),
      visualIdeas: z.array(z.string()).default([]),
      literalness: z.number().min(0).max(1),
      ironyPotential: z.number().min(0).max(1),
      energy: z.number().min(0).max(1),
    }),
  ),
});

/**
 * LLM provider that routes every capability — moment suggestion, narrative
 * analysis, and timeline direction — through the Vercel AI Gateway via the AI
 * SDK (F01). Each reply is parsed against a closed schema so an invalid shape
 * fails the structured-output parse, and provenance (model, version, prompt) is
 * returned with every result.
 */
export class GatewayLLMProvider implements LLMProvider {
  readonly name = GATEWAY_NAME;

  constructor(private readonly options: { model: string }) {}

  async suggestMoments(input: MomentSuggestInput): Promise<MomentSuggestResult> {
    const { object } = await generateObject({
      model: this.options.model,
      schema: MomentsSchema,
      system: MOMENTS_PROMPT_V1,
      prompt: JSON.stringify({
        sceneId: input.sceneId,
        startMs: input.startMs,
        endMs: input.endMs,
        vision: input.vision,
        transcript: input.transcript,
      }),
    });
    const { moments } = MomentsSchema.parse(object);
    return {
      moments,
      extractor: GATEWAY_NAME,
      extractorVersion: gatewayModelVersion(this.options.model),
      promptVersion: MOMENTS_PROMPT_VERSION,
    };
  }

  async analyzeNarrative(input: NarrativeAnalyzeInput): Promise<NarrativeAnalyzeResult> {
    const { object } = await generateObject({
      model: this.options.model,
      schema: NarrativeSchema,
      system: NARRATIVE_PROMPT_V2,
      prompt: JSON.stringify({
        durationMs: input.durationMs,
        sourceStartMs: input.sourceStartMs,
        sourceEndMs: input.sourceEndMs,
        sections: input.sections,
        energyCurve: input.energyCurve,
        lyrics: input.lyrics,
      }),
    });
    const { segments } = NarrativeSchema.parse(object);
    return {
      segments,
      extractor: GATEWAY_NAME,
      extractorVersion: gatewayModelVersion(this.options.model),
      promptVersion: NARRATIVE_PROMPT_VERSION,
    };
  }

  async directTimeline(input: DirectTimelineInput): Promise<DirectTimelineResult> {
    const { object } = await generateObject({
      model: this.options.model,
      schema: DirectorPicksSchema,
      system: DIRECTOR_PROMPT_V4,
      prompt: JSON.stringify({
        durationMs: input.durationMs,
        sections: input.sections,
        segments: input.segments,
        memory: input.memory ?? { lessons: [], examples: [] },
      }),
    });

    // Re-parse so cut-style defaults apply even if the SDK hands back the raw object.
    const { picks } = DirectorPicksSchema.parse(object);

    return {
      picks,
      director: GATEWAY_NAME,
      directorVersion: gatewayModelVersion(this.options.model),
      promptVersion: DIRECTOR_PROMPT_VERSION,
    };
  }
}
