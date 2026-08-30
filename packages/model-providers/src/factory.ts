import type { AppConfig } from '@memetize/shared';
import { FixtureLLMProvider, FixtureVisionProvider } from './fixture';
import type { LLMProvider, VisionProvider } from './types';

export interface Providers {
  vision: VisionProvider;
  llm: LLMProvider;
}

/**
 * Builds providers from `AppConfig` (spec section 20). Real providers
 * (anthropic, openai, ...) are opt-in via `VISION_PROVIDER`/`LLM_PROVIDER`
 * and get added here as they're implemented; workers never construct a
 * provider themselves.
 */
export function createProviders(config: AppConfig): Providers {
  return {
    vision: createVisionProvider(config.providers.vision.kind),
    llm: createLLMProvider(config.providers.llm.kind),
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
