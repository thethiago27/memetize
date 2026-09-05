import type { DirectorPickInput } from '@memetize/contracts';
import { MIN_VISUAL_SLOT_MS, TRANSITION_HANDLE_RESERVE_MS } from '@memetize/edit-planner';
import { clipId } from '@memetize/shared';
import type { AssembleMoment, AssembleSegment, AssembleSegmentMatch } from './assemble';

export class InsufficientCatalogError extends Error {
  readonly code = 'INSUFFICIENT_CATALOG';

  constructor(message = 'no eligible catalog moment can cover the minimum visual slot') {
    super(message);
    this.name = 'InsufficientCatalogError';
  }
}

export interface ResolveCoverageInput {
  window: { sourceStartMs: number; sourceEndMs: number };
  segments: readonly AssembleSegment[];
  picks: readonly DirectorPickInput[];
  matches: ReadonlyMap<string, AssembleSegmentMatch>;
  moments: ReadonlyMap<string, AssembleMoment>;
  beats: readonly number[];
}

export interface ResolvedCoverageClip {
  id: string;
  momentId: string;
  segmentId: string;
  /** Mirrors the matching `CoverageDecision.role` so Assemble can tell the
   * Director's primary clip from tiles without re-deriving it. */
  role: CoverageDecision['role'];
  timeline: { startMs: number; endMs: number };
  source: { assetId: string; startMs: number; endMs: number };
}

export interface CoverageDecision {
  segmentId: string;
  momentId: string;
  role: 'primary' | 'fallback' | 'tile';
  reason: string;
}

export interface CoverageResolution {
  clips: ResolvedCoverageClip[];
  decisions: CoverageDecision[];
}

/**
 * Resolves coverage, retrying once without beat snapping when the beat-aware
 * pass declares the catalog insufficient (F02).
 *
 * Beat snapping can leave an unabsorbable tail even when the available material
 * would cover the segment outright (e.g. two 2000 ms moments on a 4000 ms
 * segment with beats at 0/1500/3000 snap to 1500+1500 and strand 1000 ms).
 * Coverage must take precedence over the preference for landing on a beat, so we
 * fall back to a beat-free pass before giving up. `resolveCoverageOnce` keeps its
 * clip lists local, so the abandoned attempt never publishes partial clips; a
 * catalog that genuinely cannot cover the span still throws from the retry.
 */
export function resolveCoverage(input: ResolveCoverageInput): CoverageResolution {
  try {
    return resolveCoverageOnce(input);
  } catch (error) {
    if (!(error instanceof InsufficientCatalogError) || input.beats.length === 0) {
      throw error;
    }
    const fallback = resolveCoverageOnce({ ...input, beats: [] });
    return {
      ...fallback,
      decisions: fallback.decisions.map((decision) => ({
        ...decision,
        reason: `${decision.reason}; coverage retry without beat snap`,
      })),
    };
  }
}

function resolveCoverageOnce(input: ResolveCoverageInput): CoverageResolution {
  const windowMs = input.window.sourceEndMs - input.window.sourceStartMs;
  const minSlotMs = windowMs > 0 && windowMs < MIN_VISUAL_SLOT_MS ? windowMs : MIN_VISUAL_SLOT_MS;
  const pickBySegment = new Map(input.picks.map((pick) => [pick.segmentId, pick.momentId]));
  const clips: ResolvedCoverageClip[] = [];
  const decisions: CoverageDecision[] = [];
  let lastAssetId: string | null = null;

  const sortedSegments = [...input.segments].sort((a, b) => a.startMs - b.startMs);
  for (const segment of sortedSegments) {
    const resolved = resolveSegment(segment, {
      pickMomentId: pickBySegment.get(segment.id),
      match: input.matches.get(segment.id),
      moments: input.moments,
      beats: input.beats,
      minSlotMs,
      lastAssetId,
      windowStartMs: input.window.sourceStartMs,
    });
    clips.push(...resolved.clips);
    decisions.push(...resolved.decisions);
    lastAssetId = resolved.clips.at(-1)?.source.assetId ?? lastAssetId;
  }

  if (clips.length === 0) {
    throw new InsufficientCatalogError(
      `no clips could be resolved for window [${input.window.sourceStartMs}, ${input.window.sourceEndMs}]`,
    );
  }

  return { clips, decisions };
}

function resolveSegment(
  segment: AssembleSegment,
  context: {
    pickMomentId: string | undefined;
    match: AssembleSegmentMatch | undefined;
    moments: ReadonlyMap<string, AssembleMoment>;
    beats: readonly number[];
    minSlotMs: number;
    lastAssetId: string | null;
    windowStartMs: number;
  },
): { clips: ResolvedCoverageClip[]; decisions: CoverageDecision[] } {
  const candidates = orderedCandidates(
    segment.id,
    context.pickMomentId,
    context.match,
    context.moments,
  );
  const usedMomentIds = new Set<string>();
  const clips: ResolvedCoverageClip[] = [];
  const decisions: CoverageDecision[] = [];
  let cursor = segment.startMs;
  let lastAssetId = context.lastAssetId;

  while (cursor < segment.endMs) {
    const remainder = segment.endMs - cursor;
    const placed = placeNextClip({
      segment,
      cursor,
      remainder,
      candidates,
      usedMomentIds,
      lastAssetId,
      pickMomentId: context.pickMomentId,
      moments: context.moments,
      beats: context.beats,
      minSlotMs: remainder < context.minSlotMs ? remainder : context.minSlotMs,
      windowStartMs: context.windowStartMs,
    });

    if (!placed) {
      const absorbed = absorbRemainder(clips, remainder, context.moments);
      if (absorbed) break;
      throw new InsufficientCatalogError(
        `cannot cover segment ${segment.id} remainder ${remainder}ms at ${cursor}ms`,
      );
    }

    clips.push({ ...placed.clip, role: placed.decision.role });
    decisions.push(placed.decision);
    usedMomentIds.add(placed.clip.momentId);
    lastAssetId = placed.clip.source.assetId;
    cursor = context.windowStartMs + placed.clip.timeline.endMs;
  }

  return { clips, decisions };
}

function orderedCandidates(
  _segmentId: string,
  pickMomentId: string | undefined,
  match: AssembleSegmentMatch | undefined,
  moments: ReadonlyMap<string, AssembleMoment>,
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (momentId: string | undefined): void => {
    if (!momentId || seen.has(momentId) || !moments.has(momentId)) return;
    seen.add(momentId);
    ordered.push(momentId);
  };

  add(pickMomentId);
  const shortlist = [...(match?.shortlist ?? [])].sort((a, b) => b.finalScore - a.finalScore);
  for (const entry of shortlist) add(entry.momentId);
  const ranked = [...(match?.ranked ?? [])].sort((a, b) => b.finalScore - a.finalScore);
  for (const entry of ranked) add(entry.momentId);
  return ordered;
}

function placeNextClip(params: {
  segment: AssembleSegment;
  cursor: number;
  remainder: number;
  candidates: readonly string[];
  usedMomentIds: ReadonlySet<string>;
  lastAssetId: string | null;
  pickMomentId: string | undefined;
  moments: ReadonlyMap<string, AssembleMoment>;
  beats: readonly number[];
  minSlotMs: number;
  windowStartMs: number;
}): { clip: Omit<ResolvedCoverageClip, 'role'>; decision: CoverageDecision } | null {
  const unused = params.candidates.filter((momentId) => !params.usedMomentIds.has(momentId));
  const fullCover = unused.filter((momentId) => {
    const moment = params.moments.get(momentId);
    return moment !== undefined && momentDuration(moment) >= params.remainder;
  });
  const longEnough = unused.filter((momentId) => {
    const moment = params.moments.get(momentId);
    return moment !== undefined && momentDuration(moment) >= params.minSlotMs;
  });

  // Try every duration-compatible candidate in preference order instead of
  // committing to the first one: a pick that is long enough for the minimum
  // slot can still leave an unabsorbable tail (e.g. a 1867 ms moment on a
  // 1898 ms segment), and the next candidate may cover the span outright.
  const attempts: { momentId: string; reason: string }[] = [];
  const seen = new Set<string>();
  const push = (entry: { momentId: string; reason: string } | null) => {
    if (!entry || seen.has(entry.momentId)) return;
    seen.add(entry.momentId);
    attempts.push(entry);
  };
  if (
    params.usedMomentIds.size === 0 &&
    params.pickMomentId !== undefined &&
    longEnough.includes(params.pickMomentId)
  ) {
    push({ momentId: params.pickMomentId, reason: 'director primary' });
  }
  for (const entry of orderCandidates(fullCover, params.lastAssetId, params.moments)) push(entry);
  for (const entry of orderCandidates(longEnough, params.lastAssetId, params.moments)) push(entry);

  for (const pick of attempts) {
    const moment = params.moments.get(pick.momentId);
    if (!moment) continue;
    const available = momentDuration(moment);
    const takeMs = pickTakeMs(
      params.cursor,
      params.remainder,
      available,
      params.beats,
      params.minSlotMs,
    );
    if (takeMs === null) continue;
    if (takeMs < params.minSlotMs && takeMs !== params.remainder) continue;

    const timelineStart = params.cursor - params.windowStartMs;
    // Center the take within the moment so an overlapping transition has a
    // source handle on each side (F05). Reserve nothing when the moment is
    // exactly slot-sized, so tight moments still downgrade as before.
    const spareRoom = Math.max(0, available - takeMs);
    const headReserve = Math.min(TRANSITION_HANDLE_RESERVE_MS, Math.floor(spareRoom / 2));
    const sourceStartMs = moment.startMs + headReserve;
    const clip: Omit<ResolvedCoverageClip, 'role'> = {
      id: clipId(),
      momentId: pick.momentId,
      segmentId: params.segment.id,
      timeline: { startMs: timelineStart, endMs: timelineStart + takeMs },
      source: {
        assetId: moment.assetId,
        startMs: sourceStartMs,
        endMs: sourceStartMs + takeMs,
      },
    };
    const role: CoverageDecision['role'] =
      params.usedMomentIds.size === 0
        ? params.pickMomentId === pick.momentId
          ? 'primary'
          : 'fallback'
        : 'tile';
    return {
      clip,
      decision: {
        segmentId: params.segment.id,
        momentId: pick.momentId,
        role,
        reason: pick.reason,
      },
    };
  }
  return null;
}

/** Candidates that avoid repeating the previous clip's asset first, then the rest, in rank order. */
function orderCandidates(
  momentIds: readonly string[],
  lastAssetId: string | null,
  moments: ReadonlyMap<string, AssembleMoment>,
): { momentId: string; reason: string }[] {
  const avoided = lastAssetId
    ? momentIds.filter((momentId) => moments.get(momentId)?.assetId !== lastAssetId)
    : [...momentIds];
  const rest = momentIds.filter((momentId) => !avoided.includes(momentId));
  return [
    ...avoided.map((momentId, index) => ({
      momentId,
      reason:
        index === 0 && momentId !== momentIds[0]
          ? 'avoided adjacent asset reuse'
          : 'duration-compatible candidate',
    })),
    ...rest.map((momentId) => ({ momentId, reason: 'duration-compatible candidate' })),
  ];
}

function pickTakeMs(
  cursor: number,
  remainder: number,
  available: number,
  beats: readonly number[],
  minSlotMs: number,
): number | null {
  if (available >= remainder) return remainder;
  const reach = cursor + available;
  const split = strongestReachableBeat(beats, cursor, reach, remainder, minSlotMs);
  if (split !== null) return split - cursor;
  const leftover = remainder - available;
  if (leftover === 0 || leftover >= minSlotMs) return available;
  return null;
}

function strongestReachableBeat(
  beats: readonly number[],
  cursor: number,
  reach: number,
  remainder: number,
  minSlotMs: number,
): number | null {
  let best: number | null = null;
  for (const beat of beats) {
    if (beat <= cursor || beat > reach) continue;
    const after = cursor + remainder - beat;
    if (after !== 0 && after < minSlotMs) continue;
    if (beat - cursor < minSlotMs && beat !== cursor + remainder) continue;
    if (best === null || beat > best) best = beat;
  }
  return best;
}

function absorbRemainder(
  clips: ResolvedCoverageClip[],
  remainder: number,
  moments: ReadonlyMap<string, AssembleMoment>,
): boolean {
  const previous = clips.at(-1);
  if (!previous || remainder <= 0) return false;
  const moment = moments.get(previous.momentId);
  if (!moment) return false;
  // Room after the take's end, accounting for any reserved head margin.
  const momentEndMs = moment.startMs + momentDuration(moment);
  const unusedTail = momentEndMs - previous.source.endMs;
  if (unusedTail < remainder) return false;
  previous.timeline.endMs += remainder;
  previous.source.endMs += remainder;
  return true;
}

function momentDuration(moment: AssembleMoment): number {
  return moment.durationMs > 0 ? moment.durationMs : Math.max(0, moment.endMs - moment.startMs);
}
