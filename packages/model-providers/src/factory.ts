import type { AppConfig, LLMProviderConfig, LLMStage, ProviderConfig } from '@memetize/shared';
import { LLM_STAGES } from '@memetize/shared';
import { FixtureEmbeddingProvider, FixtureLLMProvider, FixtureVisionProvider } from './fixture';
import { GatewayLLMProvider } from './gateway';
import { GatewayEmbeddingProvider } from './gateway-embedding';
import { GatewayVisionProvider } from './gateway-vision';
import type { EmbeddingProvider, LLMProvider, VisionProvider } from './types';

export interface Providers {
  vision: VisionProvider;
  llm: LLMProvider;
  embedding: EmbeddingProvider;
}

/** Which capabilities run on real models vs. the deterministic fixtures (F01). */
export interface ProviderDiagnostics {
  mode: 'demo' | 'production';
  vision: 'real' | 'fixture';
  llm: 'real' | 'fixture';
  embedding: 'real' | 'fixture';
}

type ProviderMode = 'demo' | 'production';

function modeOf(kind: string): 'real' | 'fixture' {
  return kind === 'fixture' ? 'fixture' : 'real';
}

/**
 * In production mode every capability must be real: a fixture provider is
 * refused with CAPABILITY_NOT_READY so a demo build can never masquerade as a
 * real one (F01). Demo mode allows fixtures.
 */
function assertReady(mode: ProviderMode, capability: string, kind: string): void {
  if (mode === 'production' && modeOf(kind) === 'fixture') {
    throw new Error(`CAPABILITY_NOT_READY: ${capability} is still a fixture in production mode`);
  }
}

/**
 * Builds providers from `AppConfig` (spec section 20). Real providers route
 * through the AI Gateway (`gateway`); `fixture` stays the default. Workers never
 * construct a provider themselves. See `describeProviders` for which capabilities
 * are real vs. simulated.
 */
export function createProviders(config: AppConfig): Providers {
  const mode = config.providerMode;
  assertReady(mode, 'vision', config.providers.vision.kind);
  assertReady(mode, 'llm', config.providers.llm.kind);
  assertReady(mode, 'embedding', config.providers.embedding.kind);
  return {
    vision: createVisionProvider(config.providers.vision, config.aiGatewayApiKey),
    llm: createLLMProvider(config.providers.llm, config.aiGatewayApiKey),
    embedding: createEmbeddingProvider(
      config.providers.embedding,
      config.embeddingDimensions,
      config.aiGatewayApiKey,
    ),
  };
}

/** Reports, without constructing them, which capabilities are real (F01). */
export function describeProviders(config: AppConfig): ProviderDiagnostics {
  return {
    mode: config.providerMode,
    vision: modeOf(config.providers.vision.kind),
    llm: modeOf(config.providers.llm.kind),
    embedding: modeOf(config.providers.embedding.kind),
  };
}

function requireGatewayKey(capability: string, apiKey?: string | null): void {
  if (!apiKey?.trim()) {
    throw new Error(`AI_GATEWAY_API_KEY is required when ${capability} uses the gateway`);
  }
}

function requireModel(capability: string, model: string | null): string {
  const trimmed = model?.trim() ?? '';
  if (!isGatewayModelId(trimmed)) {
    throw new Error(`${capability} model must be a gateway model id (provider/model)`);
  }
  return trimmed;
}

function createVisionProvider(vision: ProviderConfig, apiKey?: string | null): VisionProvider {
  if (vision.kind === 'fixture') return new FixtureVisionProvider();
  if (vision.kind === 'gateway') {
    requireGatewayKey('VISION_PROVIDER', apiKey);
    return new GatewayVisionProvider(requireModel('VISION_MODEL', vision.model));
  }
  throw new Error(`unsupported VISION_PROVIDER "${vision.kind}" (only "fixture" and "gateway")`);
}

/** `creator/model-name`, e.g. `anthropic/claude-sonnet-4.5`. */
function isGatewayModelId(model: string): boolean {
  const slash = model.indexOf('/');
  return slash > 0 && slash < model.length - 1;
}

/** `LLM_MOMENTS_MODEL`, `LLM_NARRATIVE_MODEL`, `LLM_DIRECTOR_MODEL`. */
function stageEnvVar(stage: LLMStage): string {
  return `LLM_${stage.toUpperCase()}_MODEL`;
}

/**
 * Per-stage gateway models: only stages with an override are returned, and an
 * override that is set but malformed fails fast like `LLM_MODEL` would.
 */
function resolveStageModels(llm: LLMProviderConfig): Partial<Record<LLMStage, string>> {
  const models: Partial<Record<LLMStage, string>> = {};
  for (const stage of LLM_STAGES) {
    const override = llm.stageModels?.[stage]?.trim();
    if (override) models[stage] = requireModel(stageEnvVar(stage), override);
  }
  return models;
}

/**
 * Resolves the LLM backend. `fixture` stays the default (no network).
 * `gateway` requires a `provider/model` id and `AI_GATEWAY_API_KEY`; each
 * stage may override the model with `LLM_<STAGE>_MODEL`.
 */
export function createLLMProvider(llm: LLMProviderConfig, apiKey?: string | null): LLMProvider {
  if (llm.kind === 'fixture') {
    return new FixtureLLMProvider({
      directorStyles: llm.model?.trim() === 'styled' ? 'styled' : 'plain',
    });
  }
  if (llm.kind === 'gateway') {
    requireGatewayKey('LLM_PROVIDER', apiKey);
    return new GatewayLLMProvider({
      model: requireModel('LLM_MODEL', llm.model),
      stageModels: resolveStageModels(llm),
    });
  }
  throw new Error(`unsupported LLM_PROVIDER "${llm.kind}" (only "fixture" and "gateway")`);
}

function createEmbeddingProvider(
  embedding: ProviderConfig,
  dimensions: number,
  apiKey?: string | null,
): EmbeddingProvider {
  if (embedding.kind === 'fixture') return new FixtureEmbeddingProvider(dimensions);
  if (embedding.kind === 'gateway') {
    requireGatewayKey('EMBEDDING_PROVIDER', apiKey);
    return new GatewayEmbeddingProvider(
      dimensions,
      requireModel('EMBEDDING_MODEL', embedding.model),
    );
  }
  throw new Error(
    `unsupported EMBEDDING_PROVIDER "${embedding.kind}" (only "fixture" and "gateway")`,
  );
}
