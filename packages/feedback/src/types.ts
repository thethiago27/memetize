import type {
  FeedbackContext,
  FeedbackKind,
  FeedbackSource,
  RetrievedCandidate,
} from '@memetize/contracts';

/** What `recordFeedbackEvents` needs per row; ids and timestamps are assigned on insert. */
export interface FeedbackEventInput {
  projectId?: string | null;
  timelineVersion?: number | null;
  clipId?: string | null;
  segmentId?: string | null;
  momentId?: string | null;
  assetId?: string | null;
  kind: FeedbackKind;
  value?: number | null;
  note?: string | null;
  context?: FeedbackContext;
  source: FeedbackSource;
}

/**
 * The structural shape every pure function in this package reads. Matches
 * `FeedbackEventRow` from `@memetize/database`, so rows can be passed as-is,
 * while tests can build plain objects.
 */
export interface FeedbackEventLike {
  id: string;
  seq: number;
  projectId: string | null;
  timelineVersion: number | null;
  clipId: string | null;
  segmentId: string | null;
  momentId: string | null;
  assetId: string | null;
  kind: FeedbackKind;
  value: number | null;
  note: string | null;
  context: FeedbackContext;
  source: FeedbackSource;
  createdAt: Date;
}

/** The narrative-segment shape the context builder snapshots. */
export interface SegmentForFeedback {
  id: string;
  startMs: number;
  endMs: number;
  emotion: string;
  narrativeFunction: string;
  visualIdeas: string[];
  energy: number;
  lyrics: string;
  meaning: string;
}

export function buildSegmentContext(
  segment: SegmentForFeedback,
  retrieved?: RetrievedCandidate[],
): FeedbackContext {
  return {
    segmentId: segment.id,
    startMs: segment.startMs,
    endMs: segment.endMs,
    emotion: segment.emotion,
    narrativeFunction: segment.narrativeFunction,
    visualIdeas: segment.visualIdeas,
    energy: segment.energy,
    lyrics: segment.lyrics,
    meaning: segment.meaning,
    ...(retrieved ? { retrieved } : {}),
  };
}
