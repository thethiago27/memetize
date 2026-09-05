import {
  type Executor,
  type FeedbackEventRow,
  moments as momentsTable,
  type TimelineVersionRow,
} from '@memetize/database';
import { beatMsFromBpm, resolveCutStyles } from '@memetize/effects';
import {
  buildSegmentContext,
  type FeedbackEventInput,
  listActiveBans,
  recordFeedbackEvents,
} from '@memetize/feedback';
import { enqueueJob } from '@memetize/job-system';
import { eq, inArray } from 'drizzle-orm';
import { getAudioAnalysis } from './audio';
import { lockProject } from './coordinate';
import { listSegmentMatches } from './match';
import { listNarrativeSegments } from './narrative';
import { getLatestTimeline, insertTimelineVersion } from './timeline';

export type SwapClipErrorCode =
  | 'NO_TIMELINE'
  | 'CLIP_NOT_FOUND'
  | 'NOT_IN_SHORTLIST'
  | 'MOMENT_NOT_FOUND'
  | 'MOMENT_TOO_SHORT'
  | 'MOMENT_BANNED'
  | 'VERSION_CONFLICT';

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
  /**
   * The timeline version the editor was looking at (F09). When given, the swap
   * is refused with `VERSION_CONFLICT` if the project's latest version differs:
   * two edits based on the same version never silently drop one another. When
   * omitted the swap applies to whatever is latest under the lock.
   */
  expectedTimelineVersion?: number;
}

export interface SwapClipResult {
  timeline: TimelineVersionRow;
  /** `[SWAP_OUT, SWAP_IN]` — the editorial memory this swap wrote. */
  events: FeedbackEventRow[];
}

/**
 * Editorial clip swap (spec section 58): replace one clip's moment with
 * another from that segment's shortlist and persist a new append-only
 * `timeline_versions` row. No job, no IA — the slot, transform and effects
 * stay put so Timing/Effects work is not undone.
 *
 * The swap is also the strongest feedback signal the system gets
 * (editorial-memory spec): it records `SWAP_OUT` for the removed moment and
 * `SWAP_IN` for the new one, each with the segment context and the
 * segment's retrieval pool, and enqueues `FEEDBACK_EMBED` for both.
 *
 * The whole command — read the source version, validate, write the new version,
 * record the feedback events, enqueue their embedding jobs — runs in one
 * transaction under the per-project lock (F09): the read cannot go stale between
 * validation and commit, and a failure leaves no half-recorded edit.
 */
export async function swapClip(db: Executor, params: SwapClipParams): Promise<SwapClipResult> {
  return db.transaction(async (tx) => {
    await lockProject(tx, params.projectId);

    const source = await getLatestTimeline(tx, params.projectId);
    if (!source) {
      throw new SwapClipError('NO_TIMELINE', `project ${params.projectId} has no timeline yet`);
    }
    if (
      params.expectedTimelineVersion !== undefined &&
      params.expectedTimelineVersion !== source.version
    ) {
      throw new SwapClipError(
        'VERSION_CONFLICT',
        `timeline is at v${source.version}, not v${params.expectedTimelineVersion}; reload and retry the swap`,
      );
    }

    const clip = source.data.clips.find((entry) => entry.id === params.clipId);
    if (!clip) {
      throw new SwapClipError(
        'CLIP_NOT_FOUND',
        `clip "${params.clipId}" is not in the latest timeline`,
      );
    }

    const matches = await listSegmentMatches(tx, params.projectId);
    const match = matches.find((row) => row.segmentId === clip.reason.segmentId);
    const shortlisted = match?.shortlist.find((entry) => entry.momentId === params.momentId);
    if (!shortlisted) {
      throw new SwapClipError(
        'NOT_IN_SHORTLIST',
        `moment "${params.momentId}" is not in the shortlist for segment "${clip.reason.segmentId}"`,
      );
    }

    const moment = await tx.query.moments.findFirst({
      where: eq(momentsTable.id, params.momentId),
    });
    if (!moment) {
      throw new SwapClipError('MOMENT_NOT_FOUND', `moment not found: ${params.momentId}`);
    }

    const bans = await listActiveBans(tx);
    if (bans.momentIds.has(moment.id) || bans.assetIds.has(moment.assetId)) {
      throw new SwapClipError(
        'MOMENT_BANNED',
        `moment "${moment.id}" is banned — unban it before swapping it in`,
      );
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

    // Cut-styles spec: the new moment may not have the source handles the
    // old one had, so every transition and clip style is re-resolved against
    // the moments now on the timeline. Zooms are left as they are.
    const audio = await getAudioAnalysis(tx, params.projectId);
    const momentIds = [...new Set(nextClips.map((entry) => entry.momentId))];
    const momentRows = await tx.query.moments.findMany({
      where: inArray(momentsTable.id, momentIds),
    });
    const resolved = resolveCutStyles(
      { ...source.data, clips: nextClips },
      {
        beatMs: beatMsFromBpm(audio?.bpm),
        sourceBoundsByMomentId: new Map(
          momentRows.map((row) => [row.id, { startMs: row.startMs, endMs: row.endMs }]),
        ),
      },
    );

    const timeline = await insertTimelineVersion(tx, {
      projectId: params.projectId,
      data: resolved.timeline,
      director: 'user',
      directorVersion: '1.0.0',
      promptVersion: source.promptVersion,
      timingOptimizer: source.timingOptimizer,
      timingOptimizerVersion: source.timingOptimizerVersion,
      effectsPlanner: source.effectsPlanner,
      effectsPlannerVersion: source.effectsPlannerVersion,
    });

    const segments = await listNarrativeSegments(tx, params.projectId);
    const segment = segments.find((row) => row.id === clip.reason.segmentId);
    const context = segment
      ? buildSegmentContext(segment, match?.retrieved ?? [])
      : { segmentId: clip.reason.segmentId, retrieved: match?.retrieved ?? [] };
    const base = {
      projectId: params.projectId,
      timelineVersion: timeline.version,
      clipId: clip.id,
      segmentId: clip.reason.segmentId,
      context,
      source: 'USER' as const,
    };
    const inputs: FeedbackEventInput[] = [
      { ...base, kind: 'SWAP_OUT', momentId: clip.momentId, assetId: clip.source.assetId },
      { ...base, kind: 'SWAP_IN', momentId: moment.id, assetId: moment.assetId },
    ];
    const events = await recordFeedbackEvents(tx, inputs);
    for (const event of events) {
      await enqueueJob(tx, {
        type: 'FEEDBACK_EMBED',
        entityId: event.id,
        input: { feedbackEventId: event.id },
      });
    }

    return { timeline, events };
  });
}
