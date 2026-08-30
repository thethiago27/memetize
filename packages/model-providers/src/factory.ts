import type { AppConfig } from '@memetize/shared';
import { FixtureEmbeddingProvider, FixtureLLMProvider, FixtureVisionProvider } from './fixture';
import type { EmbeddingProvider, LLMProvider, VisionProvider } from './types';

export interface Providers {
  vision: VisionProvider;
  llm: LLMProvider;
  embedding: EmbeddingProvider;
}

/**
 * Builds providers from `AppConfig` (spec section 20). Real providers
 * (anthropic, openai, ...) are opt-in via `VISION_PROVIDER`/`LLM_PROVIDER`/
 * `EMBEDDING_PROVIDER` and get added here as they're implemented; workers
 * never construct a provider themselves.
 */
export function createProviders(config: AppConfig): Providers {
  return {
    vision: createVisionProvider(config.providers.vision.kind),
    llm: createLLMProvider(config.providers.llm.kind),
    embedding: createEmbeddingProvider(config.providers.embedding.kind, config.embeddingDimensions),
  };
}

function createVisionProvider(kind: string): VisionProvider {
  if (kind === 'fixture') return new FixtureVisionProvider();
  throw new Error(`unsupported VISION_PROVIDER "${kind}" (only "fixture" is implemented so far)`);
}

function createLLMProvider(kind: string): LLMProvider {
  if (kind === 'fixture') return new FixtureLLMProvider();
  throw new Error(`unsupported LLM_PROVIDER "${kind}" (only "fixture" is implemented so far)`);
}

function createEmbeddingProvider(kind: string, dimensions: number): EmbeddingProvider {
  if (kind === 'fixture') return new FixtureEmbeddingProvider(dimensions);
  throw new Error(
    `unsupported EMBEDDING_PROVIDER "${kind}" (only "fixture" is implemented so far)`,
  );
}
