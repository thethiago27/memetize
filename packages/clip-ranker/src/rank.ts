import { RANK_LIMIT, type RankedCandidate, type RetrievedCandidate } from '@memetize/contracts';

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

export interface RankParams {
  candidate: RetrievedCandidate;
  moment: MomentForRanking;
  segment: SegmentForRanking;
  /** momentIds already placed in a shortlist earlier in this project — the
   * spec section 30 "usage" table is for future cross-project history; this
   * is the in-project novelty signal available today. */
  previouslyShortlisted: ReadonlySet<string>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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
 * Clip Ranker (spec section 29): scores one candidate against a segment
 * using the terms already persisted by earlier phases — no new moment
 * column, no LLM call. Missing data defaults to a neutral 0.5 rather than 0
 * so a candidate is never disqualified purely for lacking optional metadata.
 */
export function rank(params: RankParams): RankedCandidate {
  const { candidate, moment, segment, previouslyShortlisted } = params;

  const semanticScore = clamp01(candidate.semanticScore);
  const emotion = emotionScore(moment, segment);
  const narrative = narrativeScore(moment, segment);
  const duration = durationScore(moment, segment);
  const energy = energyScore(moment, segment);
  const quality = moment.qualityScore ?? 0.5;
  const novelty = previouslyShortlisted.has(candidate.momentId) ? 0.2 : 1;
  const usage = 1; // no `moment_usage` yet (spec section 30: "tabela futura")

  const finalScore = clamp01(
    semanticScore * RANK_WEIGHTS.semantic +
      emotion * RANK_WEIGHTS.emotion +
      narrative * RANK_WEIGHTS.narrative +
      duration * RANK_WEIGHTS.duration +
      energy * RANK_WEIGHTS.energy +
      quality * RANK_WEIGHTS.quality +
      novelty * RANK_WEIGHTS.novelty +
      usage * RANK_WEIGHTS.usage,
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
    usageScore: usage,
    finalScore,
  };
}

export interface RankCandidatesParams {
  candidates: RetrievedCandidate[];
  moments: ReadonlyMap<string, MomentForRanking>;
  segment: SegmentForRanking;
  previouslyShortlisted: ReadonlySet<string>;
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
      });
    })
    .filter((value): value is RankedCandidate => value !== null);

  return ranked.sort((a, b) => b.finalScore - a.finalScore).slice(0, limit);
}
