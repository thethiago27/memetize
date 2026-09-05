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
 * Provider-specific options that ask the model for exactly the catalog's vector
 * width (F01). The gateway forwards `providerOptions[<creator>]` to the upstream
 * provider, and the creator is the first segment of a gateway model id
 * (`openai/text-embedding-3-small` -> `openai`). Models that support Matryoshka
 * truncation (OpenAI `text-embedding-3-*`, Google `gemini-embedding-*`) honor
 * `dimensions`/`outputDimensionality`; a model that ignores it still fails the
 * width check below instead of writing into the column at the wrong width.
 */
export function embeddingProviderOptions(
  model: string,
  dimensions: number,
): Record<string, Record<string, number>> {
  const creator = model.slice(0, model.indexOf('/'));
  const options: Record<string, number> = { dimensions };
  if (creator === 'google' || creator === 'vertex') options.outputDimensionality = dimensions;
  return { [creator]: options };
}

/**
 * Real embedding provider routed through the Vercel AI Gateway (F01). The
 * request asks for the configured width (see `embeddingProviderOptions`), so a
 * default-1536 model like `openai/text-embedding-3-small` returns 384-wide
 * vectors for the 384-wide column instead of failing every call. Vectors are
 * unit-normalized so cosine similarity is a dot product, and every vector is
 * still checked to match the configured dimensions — a model whose output width
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
      providerOptions: embeddingProviderOptions(this.model, this.dimensions),
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
