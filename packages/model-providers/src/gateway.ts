import { DirectorPick } from '@memetize/contracts';
import { DIRECTOR_PROMPT_V3, DIRECTOR_PROMPT_VERSION } from '@memetize/prompts';
import { generateObject } from 'ai';
import { z } from 'zod';
import { FixtureLLMProvider } from './fixture';
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

const DirectorPicksSchema = z.object({
  picks: z.array(DirectorPick),
});

/**
 * LLM provider that routes `directTimeline` through the Vercel AI Gateway
 * via the AI SDK. `analyzeNarrative` and `suggestMoments` stay on the
 * fixture so ingest/MATCH never spend tokens in this increment.
 */
export class GatewayLLMProvider implements LLMProvider {
  readonly name = GATEWAY_NAME;
  private readonly fixture = new FixtureLLMProvider();

  constructor(private readonly options: { model: string }) {}

  suggestMoments(input: MomentSuggestInput): Promise<MomentSuggestResult> {
    return this.fixture.suggestMoments(input);
  }

  analyzeNarrative(input: NarrativeAnalyzeInput): Promise<NarrativeAnalyzeResult> {
    return this.fixture.analyzeNarrative(input);
  }

  async directTimeline(input: DirectTimelineInput): Promise<DirectTimelineResult> {
    const { object } = await generateObject({
      model: this.options.model,
      schema: DirectorPicksSchema,
      system: DIRECTOR_PROMPT_V3,
      prompt: JSON.stringify({
        durationMs: input.durationMs,
        sections: input.sections,
        segments: input.segments,
        memory: input.memory ?? { lessons: [], examples: [] },
      }),
    });

    return {
      picks: object.picks,
      director: GATEWAY_NAME,
      directorVersion: GATEWAY_VERSION,
      promptVersion: DIRECTOR_PROMPT_VERSION,
    };
  }
}
