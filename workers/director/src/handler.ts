import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DirectorInput } from '@memetize/contracts';
import type { AssembleMoment, AssembleSegmentMatch } from '@memetize/director';
import { assembleDirectedTimeline, InsufficientCatalogError } from '@memetize/director';
import {
  aggregateFeedback,
  buildExamples,
  buildLessons,
  getConstraintsRevision,
  listActiveBans,
  listFeedbackEvents,
} from '@memetize/feedback';
import { JobFailure } from '@memetize/job-system';
import type { DirectorMemory, DirectorSegmentInput } from '@memetize/model-providers';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';
import {
  directorDebugFile,
  getAudioAnalysis,
  getLatestEditWindow,
  getProjectAudio,
  insertTimelineVersion,
  listNarrativeSegments,
  listSegmentMatches,
  setProjectStatus,
  timelineFile,
} from '@memetize/projects';
import { ensureDir } from '@memetize/shared';
import { filterBannedCandidates } from './bans';
import { hydrateShortlist } from './hydrate';
import { DirectorInvalidPickError, validatePicks } from './validate';

/**
 * DIRECTOR handler: picks a primary moment per shortlist, then the coverage
 * resolver tiles every narrative span into duration-compatible clips.
 */
export function createDirectorHandler(): JobHandler {
  return async (ctx) => {
    const parsed = DirectorInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId } = parsed.data;

    const window = await getLatestEditWindow(ctx.db, projectId);
    if (!window) {
      throw new JobFailure(
        'DIRECTOR_NO_WINDOW',
        `project ${projectId} has no edit window — reprocess from narrative`,
        false,
      );
    }

    const audio = await getAudioAnalysis(ctx.db, projectId);
    if (!audio) {
      throw new JobFailure(
        'DIRECTOR_NO_AUDIO',
        `project ${projectId} has no audio analysis yet`,
        false,
      );
    }
    const projectAudio = await getProjectAudio(ctx.db, projectId);
    if (!projectAudio) {
      throw new JobFailure(
        'DIRECTOR_NO_AUDIO',
        `project ${projectId} has no audio file yet`,
        false,
      );
    }

    const segments = await listNarrativeSegments(ctx.db, projectId);
    const allMatches = await listSegmentMatches(ctx.db, projectId);
    if (allMatches.length === 0) {
      throw new JobFailure(
        'DIRECTOR_NO_MATCHES',
        `project ${projectId} has no segment matches yet — run MATCH first`,
        false,
      );
    }
    // The whole catalog, not just the shortlisted moments: coverage may need a
    // moment outside a segment's pool when the pool holds only moments shorter
    // than the segment (catalog fallback). Bans are applied to all of it below.
    const allMomentRows = await ctx.db.query.moments.findMany();

    // Enforce the current bans here too (F13): `project generate` restarts at
    // DIRECTOR and reuses the persisted shortlist/ranked without re-running MATCH,
    // so a moment banned after MATCH would otherwise reappear. `listActiveBans`
    // already folds direct bans, asset bans, and excluded ranges into momentIds.
    const constraintsRevision = await getConstraintsRevision(ctx.db);
    const bans = await listActiveBans(ctx.db);
    const { momentRows, momentById, matches } = filterBannedCandidates(
      allMomentRows,
      allMatches,
      bans,
    );
    const matchBySegment = new Map(matches.map((match) => [match.segmentId, match]));

    const directorSegments: DirectorSegmentInput[] = segments.map((segment) => {
      const match = matchBySegment.get(segment.id);
      const shortlist = hydrateShortlist(match?.shortlist ?? [], momentById);
      return {
        id: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        meaning: segment.meaning,
        emotion: segment.emotion,
        narrativeFunction: segment.narrativeFunction,
        lyrics: segment.lyrics,
        energy: segment.energy,
        shortlist,
      };
    });

    // Editorial memory (editorial-memory spec): bounded, deterministic
    // lessons about the moments on these shortlists plus a few examples of
    // what the editor chose for segments like these.
    const feedbackEvents = await listFeedbackEvents(ctx.db);
    const describeMoment = (id: string) => momentById.get(id)?.description;
    const memory: DirectorMemory = {
      lessons: buildLessons({
        aggregate: aggregateFeedback(feedbackEvents),
        events: feedbackEvents,
        projectId,
        momentIds: directorSegments.flatMap((segment) =>
          segment.shortlist.map((entry) => entry.momentId),
        ),
        describe: describeMoment,
      }),
      examples: buildExamples({
        events: feedbackEvents,
        segments: directorSegments,
        describe: describeMoment,
      }),
    };

    const { llm } = createProviders(ctx.config);
    let suggestion: Awaited<ReturnType<typeof llm.directTimeline>>;
    try {
      suggestion = await llm.directTimeline({
        durationMs: window.durationMs,
        sections: audio.sections.filter(
          (section) => section.endMs > window.sourceStartMs && section.startMs < window.sourceEndMs,
        ),
        segments: directorSegments,
        memory,
      });
    } catch (error) {
      throw new JobFailure(
        'DIRECTOR_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    const shortlistBySegment = new Map(
      directorSegments.map((segment) => [
        segment.id,
        new Set(segment.shortlist.map((entry) => entry.momentId)),
      ]),
    );
    try {
      validatePicks(suggestion.picks, shortlistBySegment);
    } catch (error) {
      if (error instanceof DirectorInvalidPickError) {
        throw new JobFailure('DIRECTOR_INVALID_PICK', error.message, false);
      }
      throw error;
    }

    const momentContext = new Map<string, AssembleMoment>(
      momentRows.map((moment) => [
        moment.id,
        {
          assetId: moment.assetId,
          startMs: moment.startMs,
          endMs: moment.endMs,
          durationMs: moment.durationMs,
        },
      ]),
    );
    const matchContext = new Map<string, AssembleSegmentMatch>(
      matches.map((match) => [
        match.segmentId,
        { ranked: match.ranked, shortlist: match.shortlist },
      ]),
    );
    const beats = uniqueSorted([...audio.beats.map((beat) => beat.timeMs), ...audio.downbeats]);
    // Fallback order: best-quality, then longest, so a filler clip is at least a good one.
    const catalog = [...momentRows]
      .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0) || b.durationMs - a.durationMs)
      .map((moment) => moment.id);

    let assembled: ReturnType<typeof assembleDirectedTimeline>;
    try {
      assembled = assembleDirectedTimeline({
        projectId,
        window: {
          sourceStartMs: window.sourceStartMs,
          sourceEndMs: window.sourceEndMs,
          durationMs: window.durationMs,
        },
        audioPath: projectAudio.originalPath,
        picks: suggestion.picks,
        segments: segments.map((segment) => ({
          id: segment.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
        })),
        moments: momentContext,
        matches: matchContext,
        beats,
        catalog,
      });
    } catch (error) {
      if (error instanceof InsufficientCatalogError) {
        await setProjectStatus(ctx.db, projectId, 'FAILED');
        throw new JobFailure('INSUFFICIENT_CATALOG', error.message, false);
      }
      throw new JobFailure(
        'DIRECTOR_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    const { timeline, decisions } = assembled;

    // Publish atomically (F08/F09/F10/F13): under the project lock, only while
    // this attempt owns the job and its generation is current. The constraints
    // revision read before the model call is compared here; if a ban landed while
    // the model was thinking, the assembled clips are re-checked against the
    // current bans and a banned pick aborts the publication with a retryable
    // failure so the next attempt plans with the new constraints.
    const result = await ctx.publish(async ({ tx, enqueue }) => {
      const revisionNow = await getConstraintsRevision(tx);
      if (revisionNow !== constraintsRevision) {
        const currentBans = await listActiveBans(tx);
        const banned = timeline.clips.find(
          (clip) =>
            currentBans.momentIds.has(clip.momentId) ||
            currentBans.assetIds.has(clip.source.assetId),
        );
        if (banned) {
          throw new JobFailure(
            'DIRECTOR_CONSTRAINTS_CHANGED',
            `moment ${banned.momentId} was banned while the Director ran (constraints ${constraintsRevision} -> ${revisionNow}); re-planning`,
            true,
          );
        }
      }
      const persisted = await insertTimelineVersion(tx, {
        projectId,
        data: timeline,
        director: suggestion.director,
        directorVersion: suggestion.directorVersion,
        promptVersion: suggestion.promptVersion,
      });
      await enqueue({
        type: 'TIMING',
        entityId: projectId,
        input: { projectId, sourceTimelineVersion: persisted.version },
      });
      return {
        projectId,
        version: persisted.version,
        clipCount: timeline.clips.length,
        constraintsRevision: revisionNow,
      };
    });
    const version = result.version as number;

    const debugFile = directorDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          generationId: ctx.job.generationId,
          timelineVersion: version,
          picks: suggestion.picks,
          director: suggestion.director,
          directorVersion: suggestion.directorVersion,
          promptVersion: suggestion.promptVersion,
          windowVersion: window.version,
          constraintsRevision: result.constraintsRevision,
          memory,
          decisions,
        },
        null,
        2,
      ),
    );

    const tlFile = timelineFile(ctx.config, projectId);
    await ensureDir(dirname(tlFile.absolute));
    await writeFile(tlFile.absolute, JSON.stringify(timeline, null, 2));

    ctx.logger.info('director_completed', {
      projectId,
      version,
      clipCount: timeline.clips.length,
      windowVersion: window.version,
    });

    return result;
  };
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
