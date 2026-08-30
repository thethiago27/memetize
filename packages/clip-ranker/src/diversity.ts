import {
  type RankedCandidate,
  SHORTLIST_LIMIT,
  type ShortlistCandidate,
} from '@memetize/contracts';

/** The minimal moment shape the diversity pass needs, kept structural so
 * this package doesn't depend on `@memetize/database`. */
export interface MomentForDiversity {
  memeFunctions: string[];
  subjects: string[];
}

export interface SegmentRankedInput {
  segmentId: string;
  narrativeFunction: string;
  ranked: RankedCandidate[];
}

export interface DiversityContext {
  usedAssetIds: Set<string>;
  lastMemeFunctions: string[];
  lastSubjects: string[];
  lastNarrativeFunction: string;
}

/** Fresh, empty context for the first segment of a project. */
export function createDiversityContext(): DiversityContext {
  return {
    usedAssetIds: new Set(),
    lastMemeFunctions: [],
    lastSubjects: [],
    lastNarrativeFunction: '',
  };
}

function overlaps(a: string[], b: string[]): boolean {
  return a.length > 0 && b.some((value) => a.includes(value));
}

function buildShortlistEntry(
  candidate: RankedCandidate,
  segment: SegmentRankedInput,
  moments: ReadonlyMap<string, MomentForDiversity>,
  context: DiversityContext,
): ShortlistCandidate {
  const moment = moments.get(candidate.momentId);
  const memeFunctions = moment?.memeFunctions.map((value) => value.toLowerCase()) ?? [];
  const subjects = moment?.subjects ?? [];
  const penalties: string[] = [];
  let multiplier = 1;

  if (overlaps(context.lastMemeFunctions, memeFunctions)) {
    multiplier *= 0.85;
    penalties.push('same_category_penalty');
  }
  if (overlaps(context.lastSubjects, subjects)) {
    multiplier *= 0.7;
    penalties.push('same_character_penalty');
  }
  const isReactionSegment = segment.narrativeFunction.toLowerCase().includes('reaction');
  const wasReactionSegment = context.lastNarrativeFunction.toLowerCase().includes('reaction');
  const candidateIsReaction = memeFunctions.some((value) => value.includes('reaction'));
  if (isReactionSegment && wasReactionSegment && candidateIsReaction) {
    multiplier *= 0.8;
    penalties.push('consecutive_reaction_penalty');
  }

  return {
    momentId: candidate.momentId,
    assetId: candidate.assetId,
    finalScore: Math.max(0, Math.min(1, candidate.finalScore * multiplier)),
    penalties,
  };
}

/**
 * Diversity Engine for a single segment (spec section 30): walks its ranked
 * candidates in the order they're already sorted (by `finalScore`), skips
 * any asset already shortlisted elsewhere in the project (hard rule —
 * "não repetir mesmo asset no mesmo vídeo"), and applies soft multipliers
 * for repeated character/category/consecutive-reaction against the
 * previous segment's top pick. Mutates `context` in place so the caller can
 * run this segment-by-segment, interleaved with ranking (novelty needs the
 * *previous* segments' finalized shortlists, spec section 29's usage
 * table), rather than only as a single bulk pass at the end.
 */
export function diversifySegment(
  segment: SegmentRankedInput,
  moments: ReadonlyMap<string, MomentForDiversity>,
  context: DiversityContext,
  limit: number = SHORTLIST_LIMIT,
): ShortlistCandidate[] {
  const shortlist: ShortlistCandidate[] = [];
  const skippedForSameAsset: RankedCandidate[] = [];

  for (const candidate of segment.ranked) {
    if (shortlist.length >= limit) break;
    if (context.usedAssetIds.has(candidate.assetId)) {
      skippedForSameAsset.push(candidate);
      continue;
    }
    shortlist.push(buildShortlistEntry(candidate, segment, moments, context));
    context.usedAssetIds.add(candidate.assetId);
  }

  // Only relax same_asset_penalty when it would otherwise leave this
  // segment with *no* shortlist at all (e.g. a one-asset catalog) — a
  // shortlist that's merely short of `limit` because too few distinct
  // assets exist is a normal, honest result, not a failure mode.
  if (shortlist.length === 0) {
    for (const candidate of skippedForSameAsset) {
      if (shortlist.length >= limit) break;
      const entry = buildShortlistEntry(candidate, segment, moments, context);
      entry.penalties.push('same_asset_relaxed');
      shortlist.push(entry);
    }
  }

  const top = shortlist[0];
  const topMoment = top ? moments.get(top.momentId) : undefined;
  context.lastMemeFunctions = topMoment?.memeFunctions.map((value) => value.toLowerCase()) ?? [];
  context.lastSubjects = topMoment?.subjects ?? [];
  context.lastNarrativeFunction = segment.narrativeFunction;

  return shortlist;
}

/**
 * Convenience wrapper over `diversifySegment` for callers that already have
 * every segment ranked up front and don't need novelty to reflect this
 * run's own shortlists (e.g. tests, or a bulk re-diversify). `segments`
 * must already be in timeline order (ascending `startMs`).
 */
export function diversify(
  segments: SegmentRankedInput[],
  moments: ReadonlyMap<string, MomentForDiversity>,
  limit: number = SHORTLIST_LIMIT,
): Map<string, ShortlistCandidate[]> {
  const context = createDiversityContext();
  const result = new Map<string, ShortlistCandidate[]>();
  for (const segment of segments) {
    result.set(segment.segmentId, diversifySegment(segment, moments, context, limit));
  }
  return result;
}
