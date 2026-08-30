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

export interface AudioSectionRef {
  type: string;
  startMs: number;
  endMs: number;
}

export interface EnergyPointRef {
  timeMs: number;
  value: number;
}

export interface LyricLineRef {
  startMs: number;
  endMs: number;
  text: string;
}

export interface NarrativeSegmentSuggestion {
  startMs: number;
  endMs: number;
  lyrics: string;
  meaning: string;
  emotion: string;
  narrativeFunction: string;
  visualIdeas: string[];
  literalness: number;
  ironyPotential: number;
  energy: number;
}

export interface NarrativeAnalyzeInput {
  durationMs: number;
  sections: AudioSectionRef[];
  energyCurve: EnergyPointRef[];
  lyrics: LyricLineRef[];
}

export interface NarrativeAnalyzeResult {
  segments: NarrativeSegmentSuggestion[];
  extractor: string;
  extractorVersion: string;
  promptVersion: string;
}

/** A shortlist entry hydrated with just what the Director needs to judge it
 * (spec section 31: it never sees the full catalog row). */
export interface DirectorShortlistEntry {
  momentId: string;
  assetId: string;
  finalScore: number;
  description: string;
  durationMs: number;
  primaryEmotion: string | null;
}

export interface DirectorSegmentInput {
  id: string;
  startMs: number;
  endMs: number;
  meaning: string;
  emotion: string;
  narrativeFunction: string;
  lyrics: string;
  energy: number;
  shortlist: DirectorShortlistEntry[];
}

export interface DirectTimelineInput {
  durationMs: number;
  sections: AudioSectionRef[];
  segments: DirectorSegmentInput[];
}

export interface DirectorPickSuggestion {
  segmentId: string;
  momentId: string;
}

export interface DirectTimelineResult {
  picks: DirectorPickSuggestion[];
  director: string;
  directorVersion: string;
  promptVersion: string;
}

export interface LLMProvider {
  readonly name: string;
  suggestMoments(input: MomentSuggestInput): Promise<MomentSuggestResult>;
  analyzeNarrative(input: NarrativeAnalyzeInput): Promise<NarrativeAnalyzeResult>;
  directTimeline(input: DirectTimelineInput): Promise<DirectTimelineResult>;
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
