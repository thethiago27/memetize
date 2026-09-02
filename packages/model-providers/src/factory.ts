import type { AppConfig, ProviderConfig } from '@memetize/shared';
import { FixtureEmbeddingProvider, FixtureLLMProvider, FixtureVisionProvider } from './fixture';
import { GatewayLLMProvider } from './gateway';
import type { EmbeddingProvider, LLMProvider, VisionProvider } from './types';

export interface Providers {
  vision: VisionProvider;
  llm: LLMProvider;
  embedding: EmbeddingProvider;
}

/**
 * Builds providers from `AppConfig` (spec section 20). Real providers
 * (anthropic, openai, gateway, ...) are opt-in via `VISION_PROVIDER`/
 * `LLM_PROVIDER`/`EMBEDDING_PROVIDER` and get added here as they're
 * implemented; workers never construct a provider themselves.
 */
export function createProviders(config: AppConfig): Providers {
  return {
    vision: createVisionProvider(config.providers.vision.kind),
    llm: createLLMProvider(config.providers.llm, config.aiGatewayApiKey),
    embedding: createEmbeddingProvider(config.providers.embedding.kind, config.embeddingDimensions),
  };
}

function createVisionProvider(kind: string): VisionProvider {
  if (kind === 'fixture') return new FixtureVisionProvider();
  throw new Error(`unsupported VISION_PROVIDER "${kind}" (only "fixture" is implemented so far)`);
}

/** `creator/model-name`, e.g. `anthropic/claude-sonnet-4.5`. */
function isGatewayModelId(model: string): boolean {
  const slash = model.indexOf('/');
  return slash > 0 && slash < model.length - 1;
}

/**
 * Resolves the LLM backend. `fixture` stays the default (no network).
 * `gateway` requires a `provider/model` id and `AI_GATEWAY_API_KEY`.
 */
export function createLLMProvider(llm: ProviderConfig, apiKey?: string | null): LLMProvider {
  if (llm.kind === 'fixture') {
    return new FixtureLLMProvider({
      directorStyles: llm.model?.trim() === 'styled' ? 'styled' : 'plain',
    });
  }
  if (llm.kind === 'gateway') {
    const model = llm.model?.trim() ?? '';
    if (!isGatewayModelId(model)) {
      throw new Error(
        'LLM_MODEL must be a gateway model id (provider/model) when LLM_PROVIDER=gateway',
      );
    }
    if (!apiKey?.trim()) {
      throw new Error('AI_GATEWAY_API_KEY is required when LLM_PROVIDER=gateway');
    }
    return new GatewayLLMProvider({ model });
  }
  throw new Error(
    `unsupported LLM_PROVIDER "${llm.kind}" (only "fixture" and "gateway" are implemented so far)`,
  );
}

function createEmbeddingProvider(kind: string, dimensions: number): EmbeddingProvider {
  if (kind === 'fixture') return new FixtureEmbeddingProvider(dimensions);
  throw new Error(
    `unsupported EMBEDDING_PROVIDER "${kind}" (only "fixture" is implemented so far)`,
  );
}
