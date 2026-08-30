import { describe, expect, it } from 'vitest';
import { EmbeddingType, SearchHit } from './embeddings';

describe('embeddings contracts', () => {
  it('accepts the three known embedding types and rejects anything else', () => {
    expect(EmbeddingType.safeParse('VISUAL').success).toBe(true);
    expect(EmbeddingType.safeParse('MEME').success).toBe(true);
    expect(EmbeddingType.safeParse('NARRATIVE').success).toBe(true);
    expect(EmbeddingType.safeParse('AUDIO').success).toBe(false);
  });

  it('parses a search hit with an integer time range and a numeric score', () => {
    const result = SearchHit.safeParse({
      momentId: 'mom_1',
      assetId: 'ast_1',
      startMs: 0,
      endMs: 1500,
      description: 'a person realizing something terrible happened',
      score: 0.94,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a search hit with float millisecond bounds', () => {
    const result = SearchHit.safeParse({
      momentId: 'mom_1',
      assetId: 'ast_1',
      startMs: 0.5,
      endMs: 1500,
      description: 'x',
      score: 0.5,
    });
    expect(result.success).toBe(false);
  });
});
