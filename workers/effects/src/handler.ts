import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EffectsInput, WORKER_VERSION } from '@memetize/contracts';
import { planEffects } from '@memetize/effects';
import { recordFeedbackEvents, toPlacedEvents } from '@memetize/feedback';
import { JobFailure } from '@memetize/job-system';
import type { JobHandler } from '@memetize/orchestrator';
import {
  effectsDebugFile,
  getLatestTimeline,
  insertTimelineVersion,
  listNarrativeSegments,
  setProjectStatus,
  timelineFile,
} from '@memetize/projects';
import { validateTimeline } from '@memetize/renderer';
import { ensureDir } from '@memetize/shared';

/**
 * EFFECTS handler (spec sections 33, 57): runs right after `TIMING`, before
 * `RENDER`. Separate from the Director (`which` clip) and Timing (`when`)
 * — it only fills `clip.effects` with a punchline zoom. No model, no GPU.
 * This is the worker that advances the project to `TIMELINE_READY`.
 */
export function createEffectsHandler(): JobHandler {
  return async (ctx) => {
    const parsed = EffectsInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId } = parsed.data;

    const sourceVersion = await getLatestTimeline(ctx.db, projectId);
    if (!sourceVersion) {
      throw new JobFailure(
        'EFFECTS_NO_TIMELINE',
        `project ${projectId} has no timeline yet`,
        false,
      );
    }

    const segments = await listNarrativeSegments(ctx.db, projectId);
    const segmentById = new Map(
      segments.map((segment) => [
        segment.id,
        { narrativeFunction: segment.narrativeFunction, energy: segment.energy },
      ]),
    );

    const result = planEffects(sourceVersion.data, { segmentById });

    const validation = validateTimeline(result.timeline);
    if (!validation.ok) {
      throw new JobFailure(
        'EFFECTS_INVALID_RESULT',
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
      timingOptimizer: sourceVersion.timingOptimizer,
      timingOptimizerVersion: sourceVersion.timingOptimizerVersion,
      effectsPlanner: 'heuristic',
      effectsPlannerVersion: WORKER_VERSION.EFFECTS,
    });

    const debugFile = effectsDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          sourceTimelineVersion: sourceVersion.version,
          planned: result.planned,
        },
        null,
        2,
      ),
    );

    const tlFile = timelineFile(ctx.config, projectId);
    await ensureDir(dirname(tlFile.absolute));
    await writeFile(tlFile.absolute, JSON.stringify(result.timeline, null, 2));

    await setProjectStatus(ctx.db, projectId, 'TIMELINE_READY');

    // Editorial memory: every clip on the finished slate is a placement the
    // cross-project novelty term and later video ratings can refer to.
    const placed = await recordFeedbackEvents(
      ctx.db,
      toPlacedEvents({
        projectId,
        timelineVersion: persisted.version,
        timeline: result.timeline,
        segments,
      }),
    );

    ctx.logger.info('effects_completed', {
      projectId,
      version: persisted.version,
      clipsWithEffects: result.planned.length,
      placedEvents: placed.length,
    });

    return {
      projectId,
      version: persisted.version,
      clipsWithEffects: result.planned.length,
    };
  };
}
