import type { VisionSceneAnalysis } from '@memetize/contracts';

/**
 * No worker depends directly on a specific model (spec section 20): they only
 * see these interfaces. Swapping `fixture` for a local model or an external
 * API happens entirely inside the provider implementation.
 */

export interface FrameRef {
  timestampMs: number;
  path: string;
}

export interface TranscriptRef {
  startMs: number;
  endMs: number;
  text: string;
}

export interface VisionAnalyzeInput {
  sceneId: string;
  startMs: number;
  endMs: number;
  frames: FrameRef[];
  transcript: TranscriptRef[];
}

export interface VisionAnalyzeResult {
  result: VisionSceneAnalysis;
  model: string;
  modelVersion: string;
  promptVersion: string;
  /** Unparsed provider response, kept for debugging (spec section 64). */
  raw: unknown;
}

export interface VisionProvider {
  readonly name: string;
  analyze(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult>;
}

export interface MomentSuggestion {
  startMs: number;
  endMs: number;
  description: string;
  primaryEmotion: string | null;
  emotionIntensity: number | null;
  visualEnergy: number | null;
  qualityScore: number | null;
  metadata: Record<string, unknown>;
}

export interface MomentSuggestInput {
  sceneId: string;
  startMs: number;
  endMs: number;
  vision: VisionSceneAnalysis;
  transcript: TranscriptRef[];
}

export interface MomentSuggestResult {
  moments: MomentSuggestion[];
  extractor: string;
  extractorVersion: string;
  promptVersion: string;
}

export interface LLMProvider {
  readonly name: string;
  suggestMoments(input: MomentSuggestInput): Promise<MomentSuggestResult>;
}

export interface EmbedResult {
  /** One vector per input text, same order, each `dimensions` long. */
  vectors: number[][];
  model: string;
  modelVersion: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<EmbedResult>;
}
