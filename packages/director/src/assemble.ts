import type { DirectorPick, RankedCandidate, ShortlistCandidate } from '@memetize/contracts';
import { clipId } from '@memetize/shared';
import {
  DEFAULT_CANVAS,
  DEFAULT_TRANSFORM,
  Timeline,
  type TimelineCanvas,
  type TimelineClipReason,
} from '@memetize/timeline';

/** The minimal narrative segment shape this package needs, kept structural
 * so it doesn't depend on `@memetize/database`. */
export interface AssembleSegment {
  id: string;
  startMs: number;
  endMs: number;
}

/** The minimal moment shape this package needs. */
export interface AssembleMoment {
  assetId: string;
  startMs: number;
  durationMs: number;
}

export interface AssembleSegmentMatch {
  ranked: RankedCandidate[];
  shortlist: ShortlistCandidate[];
}

export interface AssembleTimelineParams {
  projectId: string;
  durationMs: number;
  /** Repo-relative path to the source audio (spec section 11). */
  audioPath: string;
  canvas?: TimelineCanvas;
  picks: DirectorPick[];
  segments: readonly AssembleSegment[];
  moments: ReadonlyMap<string, AssembleMoment>;
  /** Keyed by segmentId — the funnel `MATCH` already persisted for that segment. */
  matches: ReadonlyMap<string, AssembleSegmentMatch>;
}

/**
 * `reason.semanticScore` comes from the Clip Ranker's per-candidate
 * breakdown (spec section 29); when the picked moment isn't in `ranked`
 * (e.g. it fell out of the top `RANK_LIMIT` before diversification, but
 * survived into the shortlist some other way) the shortlist's `finalScore`
 * is the next best signal available (spec section 54's assemble step 4).
 */
function reasonFor(
  segmentId: string,
  momentId: string,
  match: AssembleSegmentMatch | undefined,
): TimelineClipReason {
  const ranked = match?.ranked.find((entry) => entry.momentId === momentId);
  const shortlisted = match?.shortlist.find((entry) => entry.momentId === momentId);
  const finalScore = shortlisted?.finalScore ?? ranked?.finalScore ?? 0;
  const semanticScore = ranked?.semanticScore ?? shortlisted?.finalScore ?? finalScore;
  return { segmentId, semanticScore, finalScore };
}

/**
 * Pure builder (spec sections 31, 34, 54): turns the Director's picks into
 * the official `Timeline` document. Timing is naive — Fase 8 aligns
 * punchlines to downbeats; here a clip spans its whole segment and its
 * source cut is whichever is shorter between the moment and the segment
 * (a moment shorter than its segment leaves an acceptable gap, never a
 * speed-up).
 */
export function assembleTimeline(params: AssembleTimelineParams): Timeline {
  const segmentsById = new Map(params.segments.map((segment) => [segment.id, segment]));

  const clips = params.picks.map((pick) => {
    const segment = segmentsById.get(pick.segmentId);
    if (!segment) {
      throw new Error(`assembleTimeline: pick references unknown segment "${pick.segmentId}"`);
    }
    const moment = params.moments.get(pick.momentId);
    if (!moment) {
      throw new Error(`assembleTimeline: pick references unknown moment "${pick.momentId}"`);
    }

    const segmentDurationMs = segment.endMs - segment.startMs;
    const sourceDurationMs = Math.min(moment.durationMs, segmentDurationMs);

    return {
      id: clipId(),
      momentId: pick.momentId,
      timeline: { startMs: segment.startMs, endMs: segment.endMs },
      source: {
        assetId: moment.assetId,
        startMs: moment.startMs,
        endMs: moment.startMs + sourceDurationMs,
      },
      transform: DEFAULT_TRANSFORM,
      effects: [],
      reason: reasonFor(pick.segmentId, pick.momentId, params.matches.get(pick.segmentId)),
    };
  });

  clips.sort((a, b) => a.timeline.startMs - b.timeline.startMs);

  return Timeline.parse({
    projectId: params.projectId,
    canvas: params.canvas ?? DEFAULT_CANVAS,
    durationMs: params.durationMs,
    audio: {
      path: params.audioPath,
      timelineStartMs: 0,
      sourceStartMs: 0,
      volume: 1,
    },
    clips,
  });
}
