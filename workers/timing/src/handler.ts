import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TimingInput, WORKER_VERSION } from '@memetize/contracts';
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

/**
 * TIMING handler (spec section 32, 56): runs right after `DIRECTOR`, before
 * `EFFECTS`. Separate from the Director on purpose — it never picks *which*
 * moment plays, only nudges *when* each already-picked clip starts and
 * ends, snapping to the nearest musical beat/downbeat. The `Timeline`
 * document's shape never changes; only `clip.timeline` ranges shift. The
 * Effects Planner, not this worker, advances the project to `TIMELINE_READY`.
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

    const beats = mergeBeats(audio.beats, audio.downbeats);
    const result = optimizeTiming(sourceVersion.data, { beats, segmentFunctionById });

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
