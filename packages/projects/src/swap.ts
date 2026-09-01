import {
  type Database,
  moments as momentsTable,
  type TimelineVersionRow,
} from '@memetize/database';
import { eq } from 'drizzle-orm';
import { listSegmentMatches } from './match';
import { getLatestTimeline, insertTimelineVersion } from './timeline';

export type SwapClipErrorCode =
  | 'NO_TIMELINE'
  | 'CLIP_NOT_FOUND'
  | 'NOT_IN_SHORTLIST'
  | 'MOMENT_NOT_FOUND'
  | 'MOMENT_TOO_SHORT';

export class SwapClipError extends Error {
  readonly code: SwapClipErrorCode;

  constructor(code: SwapClipErrorCode, message: string) {
    super(message);
    this.name = 'SwapClipError';
    this.code = code;
  }
}

export interface SwapClipParams {
  projectId: string;
  clipId: string;
  momentId: string;
}

/**
 * Editorial clip swap (spec section 58): replace one clip's moment with
 * another from that segment's shortlist and persist a new append-only
 * `timeline_versions` row. No job, no IA — the slot, transform and effects
 * stay put so Timing/Effects work is not undone.
 */
export async function swapClip(db: Database, params: SwapClipParams): Promise<TimelineVersionRow> {
  const source = await getLatestTimeline(db, params.projectId);
  if (!source) {
    throw new SwapClipError('NO_TIMELINE', `project ${params.projectId} has no timeline yet`);
  }

  const clip = source.data.clips.find((entry) => entry.id === params.clipId);
  if (!clip) {
    throw new SwapClipError(
      'CLIP_NOT_FOUND',
      `clip "${params.clipId}" is not in the latest timeline`,
    );
  }

  const matches = await listSegmentMatches(db, params.projectId);
  const match = matches.find((row) => row.segmentId === clip.reason.segmentId);
  const shortlisted = match?.shortlist.find((entry) => entry.momentId === params.momentId);
  if (!shortlisted) {
    throw new SwapClipError(
      'NOT_IN_SHORTLIST',
      `moment "${params.momentId}" is not in the shortlist for segment "${clip.reason.segmentId}"`,
    );
  }

  const moment = await db.query.moments.findFirst({
    where: eq(momentsTable.id, params.momentId),
  });
  if (!moment) {
    throw new SwapClipError('MOMENT_NOT_FOUND', `moment not found: ${params.momentId}`);
  }

  const slotMs = clip.timeline.endMs - clip.timeline.startMs;
  if (moment.durationMs < slotMs) {
    throw new SwapClipError(
      'MOMENT_TOO_SHORT',
      `moment "${moment.id}" is ${moment.durationMs}ms but clip "${clip.id}" requires ${slotMs}ms`,
    );
  }

  const nextClips = source.data.clips.map((entry) => {
    if (entry.id !== clip.id) return entry;
    return {
      ...entry,
      momentId: moment.id,
      source: {
        assetId: moment.assetId,
        startMs: moment.startMs,
        endMs: moment.startMs + slotMs,
      },
      reason: {
        ...entry.reason,
        finalScore: shortlisted.finalScore,
      },
    };
  });

  return insertTimelineVersion(db, {
    projectId: params.projectId,
    data: { ...source.data, clips: nextClips },
    director: 'user',
    directorVersion: '1.0.0',
    promptVersion: source.promptVersion,
    timingOptimizer: source.timingOptimizer,
    timingOptimizerVersion: source.timingOptimizerVersion,
    effectsPlanner: source.effectsPlanner,
    effectsPlannerVersion: source.effectsPlannerVersion,
  });
}
