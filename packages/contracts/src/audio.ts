import { z } from 'zod';
import { LyricSource } from './enums';

/**
 * Project (music) pipeline worker I/O contracts (spec sections 25-27).
 * All time values are integer milliseconds (spec section 4.4); BPM, energy
 * and score-like fields are plain numbers since they are not durations.
 */

// AUDIO_ANALYZE
export const AudioAnalyzeInput = z.object({
  projectId: z.string(),
  originalPath: z.string(),
  durationMs: z.number().int().positive(),
});
export type AudioAnalyzeInput = z.infer<typeof AudioAnalyzeInput>;

export const BeatPoint = z.object({
  timeMs: z.number().int().nonnegative(),
  strength: z.number().min(0).max(1),
});
export type BeatPoint = z.infer<typeof BeatPoint>;

export const AudioSection = z.object({
  type: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type AudioSection = z.infer<typeof AudioSection>;

export const EnergyPoint = z.object({
  timeMs: z.number().int().nonnegative(),
  value: z.number().min(0).max(1),
});
export type EnergyPoint = z.infer<typeof EnergyPoint>;

/** Raw contract emitted by the Python audio analyzer (spec section 25). */
export const AudioAnalyzeOutput = z.object({
  projectId: z.string(),
  durationMs: z.number().int().nonnegative(),
  bpm: z.number().positive(),
  beats: z.array(BeatPoint),
  downbeats: z.array(z.number().int().nonnegative()),
  sections: z.array(AudioSection),
  energyCurve: z.array(EnergyPoint),
  analyzer: z.string(),
  analyzerVersion: z.string(),
});
export type AudioAnalyzeOutput = z.infer<typeof AudioAnalyzeOutput>;

// LYRICS
export const LyricsInput = z.object({
  projectId: z.string(),
  lyricsPath: z.string().nullable().default(null),
  /** Repo-relative path to the project's audio; used when lyrics are
   * transcribed rather than user-supplied (spec section 26). */
  originalPath: z.string().optional(),
  durationMs: z.number().int().positive(),
});
export type LyricsInput = z.infer<typeof LyricsInput>;

export const LyricWord = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type LyricWord = z.infer<typeof LyricWord>;

export const LyricLine = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  words: z.array(LyricWord).default([]),
});
export type LyricLine = z.infer<typeof LyricLine>;

export const LyricsOutput = z.object({
  projectId: z.string(),
  source: LyricSource,
  lines: z.array(LyricLine),
  model: z.string(),
  modelVersion: z.string(),
});
export type LyricsOutput = z.infer<typeof LyricsOutput>;

// NARRATIVE
export const NarrativeInput = z.object({
  projectId: z.string(),
});
export type NarrativeInput = z.infer<typeof NarrativeInput>;

/** One editorial/narrative unit derived from lyrics + musical structure (spec section 27). */
export const NarrativeSegment = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  lyrics: z.string(),
  meaning: z.string(),
  emotion: z.string(),
  narrativeFunction: z.string(),
  visualIdeas: z.array(z.string()).default([]),
  literalness: z.number().min(0).max(1),
  ironyPotential: z.number().min(0).max(1),
  energy: z.number().min(0).max(1),
});
export type NarrativeSegment = z.infer<typeof NarrativeSegment>;

export const NarrativeOutput = z.object({
  projectId: z.string(),
  segments: z.array(NarrativeSegment),
  extractor: z.string(),
  extractorVersion: z.string(),
  promptVersion: z.string(),
});
export type NarrativeOutput = z.infer<typeof NarrativeOutput>;
