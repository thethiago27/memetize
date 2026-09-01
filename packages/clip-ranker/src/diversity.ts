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
  lastAssetId: string | null;
  lastMemeFunctions: string[];
  lastSubjects: string[];
  lastNarrativeFunction: string;
}

/** Fresh, empty context for the first segment of a project. */
export function createDiversityContext(): DiversityContext {
  return {
    lastAssetId: null,
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
 * Diversity Engine for a single segment: prefers candidates whose asset
 * differs from the previous segment's top pick, then applies soft
 * category/subject/reaction penalties. Mutates `context` in place.
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
    if (context.lastAssetId !== null && candidate.assetId === context.lastAssetId) {
      skippedForSameAsset.push(candidate);
      continue;
    }
    shortlist.push(buildShortlistEntry(candidate, segment, moments, context));
  }

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
  context.lastAssetId = top?.assetId ?? context.lastAssetId;
  context.lastMemeFunctions = topMoment?.memeFunctions.map((value) => value.toLowerCase()) ?? [];
  context.lastSubjects = topMoment?.subjects ?? [];
  context.lastNarrativeFunction = segment.narrativeFunction;

  return shortlist;
}

/**
 * Convenience wrapper over `diversifySegment` for callers that already have
 * every segment ranked up front. `segments` must already be in timeline order.
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
