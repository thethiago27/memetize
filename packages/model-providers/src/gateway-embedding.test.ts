import { embedMany } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  embeddingProviderOptions,
  embeddingSpaceId,
  GatewayEmbeddingProvider,
} from './gateway-embedding';

vi.mock('ai', () => ({
  embedMany: vi.fn(),
  gateway: { textEmbeddingModel: (id: string) => ({ id }) },
}));

const embedManyMock = vi.mocked(embedMany);

describe('GatewayEmbeddingProvider (F01)', () => {
  beforeEach(() => embedManyMock.mockReset());

  it('normalizes vectors and reports the space id as modelVersion', async () => {
    embedManyMock.mockResolvedValue({ embeddings: [[3, 4]] } as never);
    const provider = new GatewayEmbeddingProvider(2, 'openai/text-embedding-3-small');
    const { vectors, model, modelVersion } = await provider.embed(['hello']);
    expect(vectors[0]).toEqual([0.6, 0.8]); // 3/5, 4/5
    expect(model).toBe('openai/text-embedding-3-small');
    expect(modelVersion).toBe(embeddingSpaceId('openai/text-embedding-3-small', 2));
  });

  it('rejects a vector whose width differs from the configured dimensions', async () => {
    embedManyMock.mockResolvedValue({ embeddings: [[1, 2, 3]] } as never);
    const provider = new GatewayEmbeddingProvider(2, 'openai/text-embedding-3-small');
    await expect(provider.embed(['hello'])).rejects.toThrow(/EMBEDDING_DIMENSION_MISMATCH/);
  });

  it('returns no vectors for no input without calling the model', async () => {
    const provider = new GatewayEmbeddingProvider(2, 'openai/text-embedding-3-small');
    const result = await provider.embed([]);
    expect(result.vectors).toEqual([]);
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('asks the model for the configured width instead of accepting its default (F01)', async () => {
    embedManyMock.mockResolvedValue({
      embeddings: [Array.from({ length: 384 }, () => 1)],
    } as never);
    const provider = new GatewayEmbeddingProvider(384, 'openai/text-embedding-3-small');
    await provider.embed(['hello']);
    const call = embedManyMock.mock.calls[0]?.[0];
    // text-embedding-3-small returns 1536 dims by default; the request must pin 384.
    expect(call).toMatchObject({
      values: ['hello'],
      providerOptions: { openai: { dimensions: 384 } },
    });
  });

  it('routes the width option to the model creator named by the gateway id', () => {
    expect(embeddingProviderOptions('openai/text-embedding-3-large', 384)).toEqual({
      openai: { dimensions: 384 },
    });
    expect(embeddingProviderOptions('google/gemini-embedding-001', 384)).toEqual({
      google: { dimensions: 384, outputDimensionality: 384 },
    });
  });

  it('spaces differ by model and dimensions', () => {
    expect(embeddingSpaceId('a', 384)).not.toBe(embeddingSpaceId('b', 384));
    expect(embeddingSpaceId('a', 384)).not.toBe(embeddingSpaceId('a', 512));
  });
});
