import { RANK_LIMIT, type RankedCandidate, type RetrievedCandidate } from '@memetize/contracts';

export const RANKER_NAME = 'clip-ranker';
/** 2.0.0: usage and novelty read editorial memory (editorial-memory spec). */
export const RANKER_VERSION = '2.0.0';

/**
 * Weights from the spec's initial score (section 29). Kept as a named
 * constant (rather than inlined in `rank`) so a future tuning pass has one
 * place to change, and so a test can assert they still sum to 1.
 */
export const RANK_WEIGHTS = {
  semantic: 0.35,
  emotion: 0.15,
  narrative: 0.15,
  duration: 0.1,
  energy: 0.1,
  quality: 0.05,
  novelty: 0.05,
  usage: 0.05,
} as const;

/** A NEGATIVE feedback vector at least this similar to the segment counts as "the editor rejected this here". */
export const NEGATIVE_MATCH_THRESHOLD = 0.75;
/** Cross-project reuse saturates after this many other projects (novelty floor 0.5). */
export const NOVELTY_PROJECT_CAP = 3;

/** The minimal moment shape the ranker needs, kept structural so this
 * package doesn't depend on `@memetize/database`. */
export interface MomentForRanking {
  durationMs: number;
  primaryEmotion: string | null;
  visualEnergy: number | null;
  qualityScore: number | null;
  metadata: Record<string, unknown>;
}

export interface SegmentForRanking {
  startMs: number;
  endMs: number;
  emotion: string;
  narrativeFunction: string;
  energy: number;
}

/** Structural mirror of `MomentUsageStats` from `@memetize/feedback`. */
export interface UsageForRanking {
  wins: number;
  losses: number;
  byFunction: ReadonlyMap<string, { wins: number; losses: number }>;
  projects: ReadonlySet<string>;
}

export interface RankParams {
  candidate: RetrievedCandidate;
  moment: MomentForRanking;
  segment: SegmentForRanking;
  /** momentIds already placed in a shortlist earlier in this project (in-project novelty). */
  previouslyShortlisted: ReadonlySet<string>;
  /** Editorial memory for this moment; undefined means no feedback yet (neutral). */
  usage?: UsageForRanking;
  /** The project being ranked, excluded from cross-project reuse counting. */
  projectId?: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Laplace-smoothed win rate: 0.5 with no data, never exactly 0 or 1. */
export function smoothedRate(wins: number, losses: number): number {
  return (wins + 1) / (wins + losses + 2);
}

function memeFunctionsOf(moment: MomentForRanking): string[] {
  const raw = moment.metadata.memeFunctions;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : [];
}

function isEmptyOrNeutral(value: string): boolean {
  return value === '' || value === 'neutral';
}

/** A field that's genuinely absent (fixture moments have no emotion, fixture
 * segments default to 'neutral') should never zero out a candidate — only a
 * real mismatch does. */
function emotionScore(moment: MomentForRanking, segment: SegmentForRanking): number {
  const a = (moment.primaryEmotion ?? '').trim().toLowerCase();
  const b = segment.emotion.trim().toLowerCase();
  if (a && b && a === b) return 1;
  if (isEmptyOrNeutral(a) && isEmptyOrNeutral(b)) return 0.5;
  return 0;
}

function narrativeScore(moment: MomentForRanking, segment: SegmentForRanking): number {
  const functions = memeFunctionsOf(moment).map((value) => value.toLowerCase());
  const target = segment.narrativeFunction.trim().toLowerCase();
  if (target && functions.includes(target)) return 1;
  if (functions.length === 0 || functions.every((value) => value === 'unclassified')) return 0.5;
  return 0;
}

function durationScore(moment: MomentForRanking, segment: SegmentForRanking): number {
  const segmentDurationMs = Math.max(segment.endMs - segment.startMs, 1);
  const diff = Math.abs(moment.durationMs - segmentDurationMs);
  return clamp01(1 - Math.min(1, diff / segmentDurationMs));
}

function energyScore(moment: MomentForRanking, segment: SegmentForRanking): number {
  if (moment.visualEnergy === null) return 0.5;
  return clamp01(1 - Math.abs(moment.visualEnergy - segment.energy));
}

/**
 * Editorial memory term: half the moment's overall win rate, half its win
 * rate in this segment's narrative role, then damped when the editor
 * rejected it from a segment that reads like this one.
 */
export function usageScore(
  candidate: Pick<RetrievedCandidate, 'negativeScore'>,
  usage: UsageForRanking | undefined,
  segment: Pick<SegmentForRanking, 'narrativeFunction'>,
): number {
  const fn = segment.narrativeFunction.trim().toLowerCase();
  const global = usage ? smoothedRate(usage.wins, usage.losses) : 0.5;
  const inRole = usage?.byFunction.get(fn);
  const contextual = inRole ? smoothedRate(inRole.wins, inRole.losses) : 0.5;
  const base = 0.5 * global + 0.5 * contextual;
  const negative = candidate.negativeScore ?? 0;
  if (negative >= NEGATIVE_MATCH_THRESHOLD) return clamp01(base * (1 - 0.5 * negative));
  return clamp01(base);
}

/** In-project reuse is the strong penalty; cross-project reuse only nudges. */
export function noveltyScore(
  momentId: string,
  previouslyShortlisted: ReadonlySet<string>,
  usage: UsageForRanking | undefined,
  projectId: string | undefined,
): number {
  if (previouslyShortlisted.has(momentId)) return 0.2;
  let others = 0;
  for (const project of usage?.projects ?? []) {
    if (project !== projectId) others += 1;
  }
  return 1 - 0.5 * (Math.min(others, NOVELTY_PROJECT_CAP) / NOVELTY_PROJECT_CAP);
}

/**
 * Clip Ranker (spec section 29): scores one candidate against a segment
 * using the terms already persisted by earlier phases plus the editorial
 * memory aggregate — no new moment column, no LLM call. Missing data
 * defaults to a neutral 0.5 rather than 0 so a candidate is never
 * disqualified purely for lacking optional metadata or feedback.
 */
export function rank(params: RankParams): RankedCandidate {
  const { candidate, moment, segment, previouslyShortlisted, usage, projectId } = params;

  const semanticScore = clamp01(candidate.semanticScore);
  const emotion = emotionScore(moment, segment);
  const narrative = narrativeScore(moment, segment);
  const duration = durationScore(moment, segment);
  const energy = energyScore(moment, segment);
  const quality = moment.qualityScore ?? 0.5;
  const novelty = noveltyScore(candidate.momentId, previouslyShortlisted, usage, projectId);
  const usageTerm = usageScore(candidate, usage, segment);

  const finalScore = clamp01(
    semanticScore * RANK_WEIGHTS.semantic +
      emotion * RANK_WEIGHTS.emotion +
      narrative * RANK_WEIGHTS.narrative +
      duration * RANK_WEIGHTS.duration +
      energy * RANK_WEIGHTS.energy +
      quality * RANK_WEIGHTS.quality +
      novelty * RANK_WEIGHTS.novelty +
      usageTerm * RANK_WEIGHTS.usage,
  );

  return {
    momentId: candidate.momentId,
    assetId: candidate.assetId,
    semanticScore,
    emotionScore: emotion,
    narrativeScore: narrative,
    durationScore: duration,
    energyScore: energy,
    qualityScore: quality,
    noveltyScore: novelty,
    usageScore: usageTerm,
    finalScore,
  };
}

export interface RankCandidatesParams {
  candidates: RetrievedCandidate[];
  moments: ReadonlyMap<string, MomentForRanking>;
  segment: SegmentForRanking;
  previouslyShortlisted: ReadonlySet<string>;
  /** Editorial memory keyed by momentId; an empty map is the no-feedback case. */
  usage?: ReadonlyMap<string, UsageForRanking>;
  projectId?: string;
  limit?: number;
}

/** Ranks every retrieved candidate and keeps the top `limit` (spec section
 * 29's ~10). Candidates whose moment can't be found (should not happen —
 * the retriever only returns moments that exist) are dropped defensively. */
export function rankCandidates(params: RankCandidatesParams): RankedCandidate[] {
  const limit = params.limit ?? RANK_LIMIT;
  const ranked = params.candidates
    .map((candidate) => {
      const moment = params.moments.get(candidate.momentId);
      if (!moment) return null;
      return rank({
        candidate,
        moment,
        segment: params.segment,
        previouslyShortlisted: params.previouslyShortlisted,
        usage: params.usage?.get(candidate.momentId),
        projectId: params.projectId,
      });
    })
    .filter((value): value is RankedCandidate => value !== null);

  return ranked.sort((a, b) => b.finalScore - a.finalScore).slice(0, limit);
}
