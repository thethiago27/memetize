import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TimingInput, WORKER_VERSION } from '@memetize/contracts';
import { moments as momentsTable } from '@memetize/database';
import { JobFailure } from '@memetize/job-system';
import type { JobHandler } from '@memetize/orchestrator';
import {
  getAudioAnalysis,
  getLatestTimeline,
  insertTimelineVersion,
  listNarrativeSegments,
  timingDebugFile,
} from '@memetize/projects';
import { validateTimeline } from '@memetize/renderer';
import { ensureDir } from '@memetize/shared';
import { mergeBeats, optimizeTiming } from '@memetize/timing';
import { inArray } from 'drizzle-orm';

/**
 * TIMING handler: rebases beats to the selected source window and snaps
 * shared clip boundaries without creating gaps.
 */
export function createTimingHandler(): JobHandler {
  return async (ctx) => {
    const parsed = TimingInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId } = parsed.data;

    const sourceVersion = await getLatestTimeline(ctx.db, projectId);
    if (!sourceVersion) {
      throw new JobFailure('TIMING_NO_TIMELINE', `project ${projectId} has no timeline yet`, false);
    }

    const audio = await getAudioAnalysis(ctx.db, projectId);
    if (!audio) {
      throw new JobFailure(
        'TIMING_NO_AUDIO',
        `project ${projectId} has no audio analysis yet`,
        false,
      );
    }

    const segments = await listNarrativeSegments(ctx.db, projectId);
    const segmentFunctionById = new Map(
      segments.map((segment) => [segment.id, segment.narrativeFunction.toLowerCase()]),
    );

    const sourceStartMs = sourceVersion.data.audio.sourceStartMs;
    const sourceEndMs = sourceStartMs + sourceVersion.data.durationMs;
    const beats = mergeBeats(audio.beats, audio.downbeats)
      .filter((beat) => beat.timeMs >= sourceStartMs && beat.timeMs <= sourceEndMs)
      .map((beat) => ({ ...beat, timeMs: beat.timeMs - sourceStartMs }));

    const momentIds = [...new Set(sourceVersion.data.clips.map((clip) => clip.momentId))];
    const momentRows =
      momentIds.length > 0
        ? await ctx.db.query.moments.findMany({
            where: inArray(momentsTable.id, momentIds),
          })
        : [];
    const sourceBoundsByMomentId = new Map(
      momentRows.map((moment) => [moment.id, { startMs: moment.startMs, endMs: moment.endMs }]),
    );

    const result = optimizeTiming(sourceVersion.data, {
      beats,
      segmentFunctionById,
      sourceBoundsByMomentId,
    });

    const validation = validateTimeline(result.timeline);
    if (!validation.ok) {
      throw new JobFailure(
        'TIMING_INVALID_RESULT',
        validation.errors.map((error) => error.message).join('; '),
        false,
      );
    }

    const persisted = await insertTimelineVersion(ctx.db, {
      projectId,
      data: result.timeline,
      director: sourceVersion.director,
      directorVersion: sourceVersion.directorVersion,
      promptVersion: sourceVersion.promptVersion,
      timingOptimizer: 'heuristic',
      timingOptimizerVersion: WORKER_VERSION.TIMING,
    });

    const debugFile = timingDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          sourceTimelineVersion: sourceVersion.version,
          adjustments: result.adjustments,
        },
        null,
        2,
      ),
    );

    await ctx.enqueue({ type: 'EFFECTS', entityId: projectId, input: { projectId } });

    const clipsAdjusted = result.adjustments.filter(
      (adjustment) => adjustment.snappedTo !== 'none',
    ).length;

    ctx.logger.info('timing_completed', {
      projectId,
      version: persisted.version,
      clipsAdjusted,
    });

    return { projectId, version: persisted.version, clipsAdjusted };
  };
}
