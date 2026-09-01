import type { DirectorPick, RankedCandidate, ShortlistCandidate } from '@memetize/contracts';
import {
  DEFAULT_CANVAS,
  DEFAULT_TRANSFORM,
  Timeline,
  type TimelineCanvas,
  type TimelineClipReason,
} from '@memetize/timeline';
import { type CoverageDecision, resolveCoverage } from './coverage';

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
  endMs: number;
  durationMs: number;
}

export interface AssembleSegmentMatch {
  ranked: RankedCandidate[];
  shortlist: ShortlistCandidate[];
}

export interface AssembleTimelineParams {
  projectId: string;
  window: { sourceStartMs: number; sourceEndMs: number; durationMs: number };
  /** Repo-relative path to the source audio (spec section 11). */
  audioPath: string;
  canvas?: TimelineCanvas;
  picks: DirectorPick[];
  segments: readonly AssembleSegment[];
  moments: ReadonlyMap<string, AssembleMoment>;
  /** Keyed by segmentId — the funnel `MATCH` already persisted for that segment. */
  matches: ReadonlyMap<string, AssembleSegmentMatch>;
  beats: readonly number[];
}

export interface AssembledTimeline {
  timeline: Timeline;
  decisions: CoverageDecision[];
}

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
 * Turns the Director's picks into a fully covered zero-based Timeline.
 * Coverage resolution owns fallback and multi-clip tiling; this function
 * only rebases onto the selected source window.
 */
export function assembleDirectedTimeline(params: AssembleTimelineParams): AssembledTimeline {
  const resolution = resolveCoverage({
    window: params.window,
    segments: params.segments,
    picks: params.picks,
    matches: params.matches,
    moments: params.moments,
    beats: params.beats,
  });

  const clips = resolution.clips.map((clip) => ({
    id: clip.id,
    momentId: clip.momentId,
    timeline: clip.timeline,
    source: clip.source,
    transform: DEFAULT_TRANSFORM,
    effects: [],
    reason: reasonFor(clip.segmentId, clip.momentId, params.matches.get(clip.segmentId)),
  }));

  clips.sort((a, b) => a.timeline.startMs - b.timeline.startMs);

  const timeline = Timeline.parse({
    projectId: params.projectId,
    canvas: params.canvas ?? DEFAULT_CANVAS,
    durationMs: params.window.durationMs,
    audio: {
      path: params.audioPath,
      timelineStartMs: 0,
      sourceStartMs: params.window.sourceStartMs,
      volume: 1,
    },
    clips,
  });

  return { timeline, decisions: resolution.decisions };
}

export function assembleTimeline(params: AssembleTimelineParams): Timeline {
  return assembleDirectedTimeline(params).timeline;
}
