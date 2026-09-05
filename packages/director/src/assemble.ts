import {
  DirectorPick,
  type DirectorPickInput,
  type RankedCandidate,
  type ShortlistCandidate,
} from '@memetize/contracts';
import {
  DEFAULT_CANVAS,
  DEFAULT_DIRECTION,
  DEFAULT_TRANSFORM,
  Timeline,
  type TimelineCanvas,
  type TimelineClipReason,
  type TimelineDirection,
} from '@memetize/timeline';
import { type CoverageDecision, type ResolvedCoverageClip, resolveCoverage } from './coverage';

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
  picks: readonly DirectorPickInput[];
  segments: readonly AssembleSegment[];
  moments: ReadonlyMap<string, AssembleMoment>;
  /** Keyed by segmentId — the funnel `MATCH` already persisted for that segment. */
  matches: ReadonlyMap<string, AssembleSegmentMatch>;
  beats: readonly number[];
  /** Eligible catalog moment ids in preference order, for coverage fallback (see `ResolveCoverageInput`). */
  catalog?: readonly string[];
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
 * Cut-styles spec: the Director proposes per segment, but coverage may tile
 * a segment into several clips. The clip style belongs to the segment's
 * primary clip and the transition to whichever clip ends the segment;
 * everything else gets the defaults. Nothing is resolved here — Effects
 * validates these against real source handles later.
 */
function directionFor(
  clip: ResolvedCoverageClip,
  pick: DirectorPick | undefined,
  isSegmentTail: boolean,
): TimelineDirection {
  if (!pick) return DEFAULT_DIRECTION;
  return {
    clipStyle: clip.role === 'primary' ? pick.clipStyle : 'none',
    transitionOut: isSegmentTail ? pick.transitionOut : 'hard',
  };
}

function segmentTailIds(clips: readonly ResolvedCoverageClip[]): Set<string> {
  const tailBySegment = new Map<string, ResolvedCoverageClip>();
  for (const clip of clips) {
    const current = tailBySegment.get(clip.segmentId);
    if (!current || clip.timeline.endMs > current.timeline.endMs) {
      tailBySegment.set(clip.segmentId, clip);
    }
  }
  return new Set([...tailBySegment.values()].map((clip) => clip.id));
}

/**
 * Turns the Director's picks into a fully covered zero-based Timeline.
 * Coverage resolution owns fallback and multi-clip tiling; this function
 * only rebases onto the selected source window.
 */
export function assembleDirectedTimeline(params: AssembleTimelineParams): AssembledTimeline {
  const picks = params.picks.map((pick) => DirectorPick.parse(pick));
  const pickBySegment = new Map(picks.map((pick) => [pick.segmentId, pick]));

  const resolution = resolveCoverage({
    window: params.window,
    segments: params.segments,
    picks,
    matches: params.matches,
    moments: params.moments,
    beats: params.beats,
    catalog: params.catalog,
  });
  const tailIds = segmentTailIds(resolution.clips);

  const clips = resolution.clips.map((clip) => ({
    id: clip.id,
    momentId: clip.momentId,
    timeline: clip.timeline,
    source: clip.source,
    transform: DEFAULT_TRANSFORM,
    effects: [],
    direction: directionFor(clip, pickBySegment.get(clip.segmentId), tailIds.has(clip.id)),
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
