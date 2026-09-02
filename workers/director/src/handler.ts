import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DirectorInput } from '@memetize/contracts';
import { moments as momentsTable } from '@memetize/database';
import type { AssembleMoment, AssembleSegmentMatch } from '@memetize/director';
import { assembleDirectedTimeline, InsufficientCatalogError } from '@memetize/director';
import {
  aggregateFeedback,
  buildExamples,
  buildLessons,
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
import { inArray } from 'drizzle-orm';
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
    const matches = await listSegmentMatches(ctx.db, projectId);
    if (matches.length === 0) {
      throw new JobFailure(
        'DIRECTOR_NO_MATCHES',
        `project ${projectId} has no segment matches yet — run MATCH first`,
        false,
      );
    }
    const matchBySegment = new Map(matches.map((match) => [match.segmentId, match]));

    const momentIds = new Set<string>();
    for (const match of matches) {
      for (const entry of match.shortlist) momentIds.add(entry.momentId);
      for (const entry of match.ranked) momentIds.add(entry.momentId);
    }
    const momentRows =
      momentIds.size > 0
        ? await ctx.db.query.moments.findMany({
            where: inArray(momentsTable.id, Array.from(momentIds)),
          })
        : [];
    const momentById = new Map(momentRows.map((moment) => [moment.id, moment]));

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
    const persisted = await insertTimelineVersion(ctx.db, {
      projectId,
      data: timeline,
      director: suggestion.director,
      directorVersion: suggestion.directorVersion,
      promptVersion: suggestion.promptVersion,
    });

    await ctx.enqueue({ type: 'TIMING', entityId: projectId, input: { projectId } });

    const debugFile = directorDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          picks: suggestion.picks,
          promptVersion: suggestion.promptVersion,
          windowVersion: window.version,
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
      version: persisted.version,
      clipCount: timeline.clips.length,
      windowVersion: window.version,
    });

    return { projectId, version: persisted.version, clipCount: timeline.clips.length };
  };
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
