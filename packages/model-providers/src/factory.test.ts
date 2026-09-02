import type { AppConfig, ProviderConfig } from '@memetize/shared';
import { describe, expect, it } from 'vitest';
import { createLLMProvider, createProviders } from './factory';
import { FixtureLLMProvider } from './fixture';
import { GatewayLLMProvider } from './gateway';

const GATEWAY_MODEL = 'anthropic/claude-sonnet-4.5';

function appConfig(llm: ProviderConfig, apiKey?: string | null): AppConfig {
  return {
    databaseUrl: 'x',
    testDatabaseUrl: null,
    rootDir: '/repo',
    storageDir: '/repo/storage',
    storageDirRelative: 'storage',
    resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
    embeddingDimensions: 384,
    aiGatewayApiKey: apiKey ?? null,
    providers: {
      transcription: { kind: 'fixture', model: null },
      vision: { kind: 'fixture', model: null },
      llm,
      embedding: { kind: 'fixture', model: null },
      audio: { kind: 'fixture', model: null },
    },
  };
}

describe('createLLMProvider', () => {
  it('returns the fixture provider when kind is fixture', () => {
    expect(createLLMProvider({ kind: 'fixture', model: null })).toBeInstanceOf(FixtureLLMProvider);
  });

  it('selects the styled fixture when LLM_MODEL is "styled"', () => {
    const provider = createLLMProvider({ kind: 'fixture', model: 'styled' });
    expect(provider).toBeInstanceOf(FixtureLLMProvider);
    expect((provider as FixtureLLMProvider).directorStyles).toBe('styled');
    expect(
      (createLLMProvider({ kind: 'fixture', model: null }) as FixtureLLMProvider).directorStyles,
    ).toBe('plain');
  });

  it('returns the gateway provider when model and key are set', () => {
    expect(createLLMProvider({ kind: 'gateway', model: GATEWAY_MODEL }, 'gw_test')).toBeInstanceOf(
      GatewayLLMProvider,
    );
  });

  it('throws when gateway is missing a model', () => {
    expect(() => createLLMProvider({ kind: 'gateway', model: null }, 'gw_test')).toThrow(
      /LLM_MODEL.*provider\/model/,
    );
  });

  it('throws when gateway model is not provider/model', () => {
    expect(() =>
      createLLMProvider({ kind: 'gateway', model: 'claude-sonnet-4.5' }, 'gw_test'),
    ).toThrow(/LLM_MODEL.*provider\/model/);
  });

  it('throws when gateway is missing an API key', () => {
    expect(() => createLLMProvider({ kind: 'gateway', model: GATEWAY_MODEL })).toThrow(
      /AI_GATEWAY_API_KEY/,
    );
    expect(() => createLLMProvider({ kind: 'gateway', model: GATEWAY_MODEL }, null)).toThrow(
      /AI_GATEWAY_API_KEY/,
    );
    expect(() => createLLMProvider({ kind: 'gateway', model: GATEWAY_MODEL }, '   ')).toThrow(
      /AI_GATEWAY_API_KEY/,
    );
  });
});

describe('createProviders', () => {
  it('keeps the fixture LLM when LLM_PROVIDER is fixture', () => {
    const { llm } = createProviders(appConfig({ kind: 'fixture', model: null }));
    expect(llm).toBeInstanceOf(FixtureLLMProvider);
    expect(llm.name).toBe('fixture');
  });

  it('wires the gateway LLM from config kind, model, and key', () => {
    const { llm } = createProviders(
      appConfig({ kind: 'gateway', model: GATEWAY_MODEL }, 'gw_test'),
    );
    expect(llm).toBeInstanceOf(GatewayLLMProvider);
    expect(llm.name).toBe('gateway');
  });

  it('fails fast when gateway config is incomplete', () => {
    expect(() =>
      createProviders(appConfig({ kind: 'gateway', model: GATEWAY_MODEL }, null)),
    ).toThrow(/AI_GATEWAY_API_KEY/);
  });
});
