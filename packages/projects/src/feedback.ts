import type { FeedbackPlacement } from '@memetize/contracts';
import type { Database, FeedbackEventRow } from '@memetize/database';
import { buildSegmentContext, listFeedbackEvents, recordFeedbackEvents } from '@memetize/feedback';
import { listSegmentMatches } from './match';
import { listNarrativeSegments } from './narrative';
import { getLatestTimeline } from './timeline';

export type ProjectFeedbackErrorCode = 'NO_TIMELINE' | 'CLIP_NOT_FOUND';

export class ProjectFeedbackError extends Error {
  readonly code: ProjectFeedbackErrorCode;

  constructor(code: ProjectFeedbackErrorCode, message: string) {
    super(message);
    this.name = 'ProjectFeedbackError';
    this.code = code;
  }
}

/**
 * `VIDEO_RATING` for the latest timeline (editorial-memory spec). The
 * placements are snapshotted so aggregation can spread the rating over the
 * moments that were actually on the slate, without re-reading timelines.
 */
export async function rateProject(
  db: Database,
  params: { projectId: string; value: number },
): Promise<FeedbackEventRow> {
  const timeline = await getLatestTimeline(db, params.projectId);
  if (!timeline) {
    throw new ProjectFeedbackError(
      'NO_TIMELINE',
      `project ${params.projectId} has no timeline yet`,
    );
  }
  const segments = await listNarrativeSegments(db, params.projectId);
  const functionBySegment = new Map(segments.map((row) => [row.id, row.narrativeFunction]));
  const placements: FeedbackPlacement[] = timeline.data.clips.map((clip) => ({
    momentId: clip.momentId,
    segmentId: clip.reason.segmentId,
    narrativeFunction: functionBySegment.get(clip.reason.segmentId) ?? '',
  }));
  const [row] = await recordFeedbackEvents(db, [
    {
      kind: 'VIDEO_RATING',
      source: 'USER',
      projectId: params.projectId,
      timelineVersion: timeline.version,
      value: params.value,
      context: { placements },
    },
  ]);
  if (!row) throw new Error('failed to record rating');
  return row;
}

/** `CLIP_UP` / `CLIP_DOWN` on a clip of the latest timeline, with the segment context. */
export async function rateClip(
  db: Database,
  params: { projectId: string; clipId: string; kind: 'CLIP_UP' | 'CLIP_DOWN' },
): Promise<FeedbackEventRow> {
  const timeline = await getLatestTimeline(db, params.projectId);
  if (!timeline) {
    throw new ProjectFeedbackError(
      'NO_TIMELINE',
      `project ${params.projectId} has no timeline yet`,
    );
  }
  const clip = timeline.data.clips.find((entry) => entry.id === params.clipId);
  if (!clip) {
    throw new ProjectFeedbackError(
      'CLIP_NOT_FOUND',
      `clip "${params.clipId}" is not in the latest timeline`,
    );
  }
  const [segments, matches] = await Promise.all([
    listNarrativeSegments(db, params.projectId),
    listSegmentMatches(db, params.projectId),
  ]);
  const segment = segments.find((row) => row.id === clip.reason.segmentId);
  const match = matches.find((row) => row.segmentId === clip.reason.segmentId);
  const context = segment
    ? buildSegmentContext(segment, match?.retrieved ?? [])
    : { segmentId: clip.reason.segmentId, retrieved: match?.retrieved ?? [] };
  const [row] = await recordFeedbackEvents(db, [
    {
      kind: params.kind,
      source: 'USER',
      projectId: params.projectId,
      timelineVersion: timeline.version,
      clipId: clip.id,
      segmentId: clip.reason.segmentId,
      momentId: clip.momentId,
      assetId: clip.source.assetId,
      context,
    },
  ]);
  if (!row) throw new Error('failed to record clip feedback');
  return row;
}

/** A free-text editorial note; null project means it applies everywhere. */
export async function addNote(
  db: Database,
  params: { projectId?: string | null; note: string },
): Promise<FeedbackEventRow> {
  const [row] = await recordFeedbackEvents(db, [
    { kind: 'NOTE', source: 'USER', projectId: params.projectId ?? null, note: params.note },
  ]);
  if (!row) throw new Error('failed to record note');
  return row;
}

export const PROJECT_FEEDBACK_LIMIT = 50;

/** Newest first: the project's own events plus global notes. */
export function listProjectFeedback(
  db: Database,
  projectId: string,
  limit = PROJECT_FEEDBACK_LIMIT,
): Promise<FeedbackEventRow[]> {
  return listFeedbackEvents(db, { projectId, order: 'desc', limit });
}
