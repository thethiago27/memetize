import { embedMany, gateway } from 'ai';
import type { EmbeddingProvider, EmbedResult } from './types';

const GATEWAY_NAME = 'gateway';

/**
 * A vector space is identified by its model plus its dimensions and
 * normalization (F01): only vectors produced in the same space may be compared.
 * Changing the model (or dimensions) is a different space and requires
 * re-indexing the catalog. This id is persisted as the embedding's modelVersion.
 */
export function embeddingSpaceId(model: string, dimensions: number): string {
  return `${model}@${dimensions}d/unit`;
}

/**
 * Real embedding provider routed through the Vercel AI Gateway (F01). Vectors
 * are unit-normalized so cosine similarity is a dot product, and every vector is
 * checked to match the configured dimensions — a model whose output width
 * differs from the catalog's vector column would silently corrupt search, so it
 * fails loudly instead. The space id travels as modelVersion for provenance.
 */
export class GatewayEmbeddingProvider implements EmbeddingProvider {
  readonly name = GATEWAY_NAME;

  constructor(
    readonly dimensions: number,
    private readonly model: string,
  ) {}

  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return { vectors: [], model: this.model, modelVersion: this.spaceId() };
    }
    const { embeddings } = await embedMany({
      model: gateway.textEmbeddingModel(this.model),
      values: texts,
    });
    const vectors = embeddings.map((vector, index) => {
      if (vector.length !== this.dimensions) {
        throw new Error(
          `EMBEDDING_DIMENSION_MISMATCH: ${this.model} returned ${vector.length} dims for input ${index}, expected ${this.dimensions}`,
        );
      }
      return normalize(vector);
    });
    return { vectors, model: this.model, modelVersion: this.spaceId() };
  }

  private spaceId(): string {
    return embeddingSpaceId(this.model, this.dimensions);
  }
}

function normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}
