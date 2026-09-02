import type { Timeline } from '@memetize/timeline';
import { buildSegmentContext, type FeedbackEventInput, type SegmentForFeedback } from './types';

export interface ToPlacedEventsParams {
  projectId: string;
  timelineVersion: number;
  timeline: Timeline;
  segments: readonly SegmentForFeedback[];
}

/**
 * One SYSTEM `PLACED` event per clip of a finished timeline (editorial-memory
 * spec): the cross-project usage signal and the anchor a later
 * `VIDEO_RATING` attaches to. Clips whose segment is unknown still count,
 * with an empty context.
 */
export function toPlacedEvents(params: ToPlacedEventsParams): FeedbackEventInput[] {
  const segmentById = new Map(params.segments.map((segment) => [segment.id, segment]));
  return params.timeline.clips.map((clip) => {
    const segment = segmentById.get(clip.reason.segmentId);
    return {
      kind: 'PLACED',
      source: 'SYSTEM',
      projectId: params.projectId,
      timelineVersion: params.timelineVersion,
      clipId: clip.id,
      segmentId: clip.reason.segmentId,
      momentId: clip.momentId,
      assetId: clip.source.assetId,
      context: segment ? buildSegmentContext(segment) : { segmentId: clip.reason.segmentId },
    };
  });
}
