import { describe, expect, it } from 'vitest';
import { FixtureEmbeddingProvider } from './fixture';

describe('FixtureEmbeddingProvider', () => {
  it('produces a vector of the configured dimension for each text', async () => {
    const provider = new FixtureEmbeddingProvider(384);
    const { vectors, model, modelVersion } = await provider.embed(['hello world', 'goodbye']);
    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      expect(vector).toHaveLength(384);
      for (const value of vector) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(model).toBe('fixture');
    expect(modelVersion).toBeTruthy();
  });

  it('is deterministic: the same text always maps to the same vector', async () => {
    const provider = new FixtureEmbeddingProvider(64);
    const [first] = (await provider.embed(['a person realizing something terrible happened']))
      .vectors;
    const [second] = (await provider.embed(['a person realizing something terrible happened']))
      .vectors;
    expect(first).toEqual(second);
  });

  it('maps different texts to different vectors', async () => {
    const provider = new FixtureEmbeddingProvider(64);
    const { vectors } = await provider.embed(['reaction shot', 'calm narration']);
    expect(vectors[0]).not.toEqual(vectors[1]);
  });

  it('respects a different configured dimension', async () => {
    const provider = new FixtureEmbeddingProvider(8);
    const { vectors } = await provider.embed(['short']);
    expect(vectors[0]).toHaveLength(8);
  });
});
