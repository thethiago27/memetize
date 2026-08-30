import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DirectorInput } from '@memetize/contracts';
import { moments as momentsTable } from '@memetize/database';
import type { AssembleMoment, AssembleSegmentMatch } from '@memetize/director';
import { assembleTimeline } from '@memetize/director';
import { JobFailure } from '@memetize/job-system';
import type { DirectorSegmentInput, DirectorShortlistEntry } from '@memetize/model-providers';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';
import {
  directorDebugFile,
  getAudioAnalysis,
  getProjectAudio,
  insertTimelineVersion,
  listNarrativeSegments,
  listSegmentMatches,
  setProjectStatus,
  timelineFile,
} from '@memetize/projects';
import { ensureDir } from '@memetize/shared';
import { inArray } from 'drizzle-orm';
import { DirectorInvalidPickError, validatePicks } from './validate';

/**
 * DIRECTOR handler (spec sections 31, 34-35, 39, 54): reads exactly what the
 * Director is allowed to see — narrative segments plus each one's shortlist
 * from `MATCH`, never the raw catalog — asks the configured `LLMProvider`
 * to pick at most one moment per segment, validates every pick against that
 * segment's own shortlist, assembles the official `Timeline`, and persists
 * it as the next append-only version before advancing the project to
 * `TIMELINE_READY`.
 */
export function createDirectorHandler(): JobHandler {
  return async (ctx) => {
    const parsed = DirectorInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId } = parsed.data;

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
    }
    const momentRows =
      momentIds.size > 0
        ? await ctx.db.query.moments.findMany({
            where: inArray(momentsTable.id, Array.from(momentIds)),
          })
        : [];
    const momentById = new Map(momentRows.map((moment) => [moment.id, moment]));

    // Only the fields spec section 31 allows the Director to see — never
    // the raw catalog (asset paths, extractor internals, ...).
    const directorSegments: DirectorSegmentInput[] = segments.map((segment) => {
      const match = matchBySegment.get(segment.id);
      const shortlist: DirectorShortlistEntry[] = (match?.shortlist ?? []).map((entry) => {
        const moment = momentById.get(entry.momentId);
        return {
          momentId: entry.momentId,
          assetId: entry.assetId,
          finalScore: entry.finalScore,
          description: moment?.description ?? '',
          durationMs: moment?.durationMs ?? 0,
          primaryEmotion: moment?.primaryEmotion ?? null,
        };
      });
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

    const { llm } = createProviders(ctx.config);
    let suggestion: Awaited<ReturnType<typeof llm.directTimeline>>;
    try {
      suggestion = await llm.directTimeline({
        durationMs: audio.durationMs,
        sections: audio.sections,
        segments: directorSegments,
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
        { assetId: moment.assetId, startMs: moment.startMs, durationMs: moment.durationMs },
      ]),
    );
    const matchContext = new Map<string, AssembleSegmentMatch>(
      matches.map((match) => [
        match.segmentId,
        { ranked: match.ranked, shortlist: match.shortlist },
      ]),
    );

    const timeline = assembleTimeline({
      projectId,
      durationMs: audio.durationMs,
      audioPath: projectAudio.originalPath,
      picks: suggestion.picks,
      segments: segments.map((segment) => ({
        id: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
      })),
      moments: momentContext,
      matches: matchContext,
    });

    const persisted = await insertTimelineVersion(ctx.db, {
      projectId,
      data: timeline,
      director: suggestion.director,
      directorVersion: suggestion.directorVersion,
      promptVersion: suggestion.promptVersion,
    });

    await setProjectStatus(ctx.db, projectId, 'TIMELINE_READY');

    const debugFile = directorDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        { projectId, picks: suggestion.picks, promptVersion: suggestion.promptVersion },
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
    });

    return { projectId, version: persisted.version, clipCount: timeline.clips.length };
  };
}
