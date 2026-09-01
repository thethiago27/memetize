import { z } from 'zod';

/**
 * Matching pipeline contracts (spec sections 28-30, 39): for each narrative
 * segment, the catalog is funneled from ~50 retrieved candidates down to a
 * shortlist of ~3, ready for the Timeline Director (spec section 31, a
 * later phase) to pick from. All scores are plain numbers in `[0, 1]`.
 */

export const RETRIEVE_LIMIT = 50;
export const RANK_LIMIT = 10;
export const SHORTLIST_LIMIT = 6;

// MATCH
export const MatchInput = z.object({
  projectId: z.string(),
});
export type MatchInput = z.infer<typeof MatchInput>;

export const MatchOutput = z.object({
  projectId: z.string(),
  segmentCount: z.number().int().nonnegative(),
  shortlistCount: z.number().int().nonnegative(),
});
export type MatchOutput = z.infer<typeof MatchOutput>;

/** What the Candidate Retriever returns per segment (spec section 28). */
export const RetrievedCandidate = z.object({
  momentId: z.string(),
  assetId: z.string(),
  semanticScore: z.number().min(0).max(1),
});
export type RetrievedCandidate = z.infer<typeof RetrievedCandidate>;

/** Per-candidate score breakdown produced by the Clip Ranker (spec section 29). */
export const RankedCandidate = z.object({
  momentId: z.string(),
  assetId: z.string(),
  semanticScore: z.number().min(0).max(1),
  emotionScore: z.number().min(0).max(1),
  narrativeScore: z.number().min(0).max(1),
  durationScore: z.number().min(0).max(1),
  energyScore: z.number().min(0).max(1),
  qualityScore: z.number().min(0).max(1),
  noveltyScore: z.number().min(0).max(1),
  usageScore: z.number().min(0).max(1),
  finalScore: z.number().min(0).max(1),
});
export type RankedCandidate = z.infer<typeof RankedCandidate>;

/** A candidate that survived the Diversity Engine (spec section 30). */
export const ShortlistCandidate = z.object({
  momentId: z.string(),
  assetId: z.string(),
  finalScore: z.number().min(0).max(1),
  penalties: z.array(z.string()).default([]),
});
export type ShortlistCandidate = z.infer<typeof ShortlistCandidate>;
