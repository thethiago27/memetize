import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EffectsInput, WORKER_VERSION } from '@memetize/contracts';
import { moments as momentsTable } from '@memetize/database';
import { beatMsFromBpm, planEffects } from '@memetize/effects';
import { recordFeedbackEvents, toPlacedEvents } from '@memetize/feedback';
import { JobFailure } from '@memetize/job-system';
import type { JobHandler } from '@memetize/orchestrator';
import {
  effectsDebugFile,
  getAudioAnalysis,
  insertTimelineVersion,
  listNarrativeSegments,
  resolveSourceTimeline,
  setProjectStatus,
  timelineFile,
  timelineVersionFile,
} from '@memetize/projects';
import { validateTimeline } from '@memetize/renderer';
import { ensureDir } from '@memetize/shared';
import { inArray } from 'drizzle-orm';

/**
 * EFFECTS handler (spec sections 33, 57; cut-styles spec): runs right after
 * `TIMING`, before `RENDER`. Separate from the Director (`which` clip) and
 * Timing (`when`) — it resolves the Director's cut styles against real
 * source handles and tempo, then fills `clip.effects` with a punchline
 * zoom. No model, no GPU. This is the worker that advances the project to
 * `TIMELINE_READY`.
 */
export function createEffectsHandler(): JobHandler {
  return async (ctx) => {
    const parsed = EffectsInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId, sourceTimelineVersion } = parsed.data;

    // Consume the version this job was pinned to (F11), never "whatever is latest now".
    const source = await resolveSourceTimeline(ctx.db, projectId, sourceTimelineVersion);
    const sourceVersion = source.row;
    if (!sourceVersion) {
      throw source.pinned
        ? new JobFailure(
            'EFFECTS_STALE_SOURCE',
            `project ${projectId} no longer has timeline v${sourceTimelineVersion}`,
            false,
          )
        : new JobFailure('EFFECTS_NO_TIMELINE', `project ${projectId} has no timeline yet`, false);
    }

    const segments = await listNarrativeSegments(ctx.db, projectId);
    const segmentById = new Map(
      segments.map((segment) => [
        segment.id,
        { narrativeFunction: segment.narrativeFunction, energy: segment.energy },
      ]),
    );

    // Cut styles need the tempo (for durations) and each moment's full
    // range (for source handles), the same bounds the Timing worker uses.
    const audio = await getAudioAnalysis(ctx.db, projectId);
    const momentIds = [...new Set(sourceVersion.data.clips.map((clip) => clip.momentId))];
    const momentRows =
      momentIds.length > 0
        ? await ctx.db.query.moments.findMany({ where: inArray(momentsTable.id, momentIds) })
        : [];
    const sourceBoundsByMomentId = new Map(
      momentRows.map((moment) => [moment.id, { startMs: moment.startMs, endMs: moment.endMs }]),
    );

    const result = planEffects(sourceVersion.data, {
      segmentById,
      beatMs: beatMsFromBpm(audio?.bpm),
      sourceBoundsByMomentId,
    });

    const validation = validateTimeline(result.timeline);
    if (!validation.ok) {
      throw new JobFailure(
        'EFFECTS_INVALID_RESULT',
        validation.errors.map((error) => error.message).join('; '),
        false,
      );
    }

    // Timeline insert, TIMELINE_READY and the PLACED memory commit together with
    // the job completion (F10), only while this attempt owns the job and its
    // generation is current (F08/F09).
    let placedCount = 0;
    const published = await ctx.publish(async ({ tx }) => {
      const persisted = await insertTimelineVersion(tx, {
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
      await setProjectStatus(tx, projectId, 'TIMELINE_READY');
      // Editorial memory: every clip on the finished slate is a placement the
      // cross-project novelty term and later video ratings can refer to.
      const placed = await recordFeedbackEvents(
        tx,
        toPlacedEvents({
          projectId,
          timelineVersion: persisted.version,
          timeline: result.timeline,
          segments,
        }),
      );
      placedCount = placed.length;
      return {
        projectId,
        version: persisted.version,
        clipsWithEffects: result.planned.length,
      };
    });

    const debugFile = effectsDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          generationId: ctx.job.generationId,
          sourceTimelineVersion: sourceVersion.version,
          timelineVersion: published.version,
          planned: result.planned,
          cuts: result.cuts,
        },
        null,
        2,
      ),
    );

    // Written under its version (spec sections 34, 54) and at the stable cache
    // path, the same as the Director does.
    const serialized = JSON.stringify(result.timeline, null, 2);
    const versionFile = timelineVersionFile(ctx.config, projectId, published.version as number);
    await ensureDir(dirname(versionFile.absolute));
    await writeFile(versionFile.absolute, serialized);

    const tlFile = timelineFile(ctx.config, projectId);
    await ensureDir(dirname(tlFile.absolute));
    await writeFile(tlFile.absolute, serialized);

    ctx.logger.info('effects_completed', {
      projectId,
      version: published.version,
      clipsWithEffects: result.planned.length,
      cutDecisions: result.cuts.length,
      placedEvents: placedCount,
    });

    return published;
  };
}
