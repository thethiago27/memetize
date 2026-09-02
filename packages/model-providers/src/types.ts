import type { VisionSceneAnalysis } from '@memetize/contracts';
import type { ClipStyle, TransitionStyle } from '@memetize/timeline';

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
  sourceStartMs: number;
  sourceEndMs: number;
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

/** One past editorial choice for a segment like one of the current ones. */
export interface DirectorExample {
  narrativeFunction: string;
  emotion: string;
  meaning: string;
  lyrics: string;
  chosenMomentId: string;
  chosenDescription: string;
}

/** Editorial memory handed to the Director (editorial-memory spec). */
export interface DirectorMemory {
  lessons: string[];
  examples: DirectorExample[];
}

export interface DirectTimelineInput {
  durationMs: number;
  sections: AudioSectionRef[];
  segments: DirectorSegmentInput[];
  /** Omitted by callers that have no memory to offer (tests, older flows). */
  memory?: DirectorMemory;
}

export interface DirectorPickSuggestion {
  segmentId: string;
  momentId: string;
  /** Cut-styles spec: proposals, resolved later by Effects. */
  clipStyle: ClipStyle;
  transitionOut: TransitionStyle;
}

/**
 * `plain` proposes no cut style (every pipeline test stays byte-identical
 * to a pre-cut-styles run); `styled` assigns fixed styles by segment
 * position so resolver, renderer, and end-to-end tests exercise every
 * vocabulary entry deterministically. Selected with `LLM_MODEL=styled`.
 */
export type FixtureDirectorStyles = 'plain' | 'styled';

export interface FixtureLLMOptions {
  directorStyles?: FixtureDirectorStyles;
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
