import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createDiversityContext,
  diversifySegment,
  type MomentForDiversity,
  type MomentForRanking,
  RANKER_NAME,
  RANKER_VERSION,
  rankCandidates,
  type SegmentRankedInput,
} from '@memetize/clip-ranker';
import { MatchInput, type RetrievedCandidate } from '@memetize/contracts';
import { moments as momentsTable, scenes as scenesTable } from '@memetize/database';
import {
  aggregateFeedback,
  listActiveBans,
  listFeedbackEvents,
  rejectionKey,
} from '@memetize/feedback';
import { JobFailure } from '@memetize/job-system';
import type { JobHandler } from '@memetize/orchestrator';
import {
  listNarrativeSegments,
  matchDebugFile,
  replaceSegmentMatches,
  type SegmentMatchInput,
  setProjectStatus,
} from '@memetize/projects';
import { retrieveForSegment } from '@memetize/retriever';
import { ensureDir } from '@memetize/shared';
import { inArray } from 'drizzle-orm';

function toMemeFunctions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  return strings.length > 0 ? strings : null;
}

/**
 * MATCH handler (spec sections 28-30, editorial-memory spec): for every
 * narrative segment, in timeline order, retrieves candidates from the
 * catalog and the feedback index, ranks them with the editorial memory
 * aggregate (spec section 29), and runs them through the Diversity Engine
 * (spec section 30) immediately — interleaved rather than as one bulk pass
 * at the end — so a segment's novelty score correctly reflects only the
 * *already finalized* shortlists of earlier segments, not its own or later
 * ones. Once persisted, chains into `DIRECTOR` (spec section 31).
 */
export function createMatchHandler(): JobHandler {
  return async (ctx) => {
    const parsed = MatchInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId } = parsed.data;

    // Idempotent: NARRATIVE already sets this, but MATCH can also be
    // reprocessed on its own (spec section 42's `reprocess --from match`).
    await setProjectStatus(ctx.db, projectId, 'PLANNING');

    // Editorial memory is read once per run and the cutoff persisted, so a
    // reprocess can be reproduced against the same feedback state.
    const feedback = aggregateFeedback(await listFeedbackEvents(ctx.db));
    // Bans resolved against the catalog: direct bans plus excluded ranges.
    const bans = await listActiveBans(ctx.db);

    const segments = await listNarrativeSegments(ctx.db, projectId);

    const retrievedBySegment = new Map<string, RetrievedCandidate[]>();
    const allMomentIds = new Set<string>();
    for (const segment of segments) {
      const rejected = feedback.rejectedBySegment.get(rejectionKey(projectId, segment.id));
      const retrieved = await retrieveForSegment(
        ctx.db,
        ctx.config,
        {
          visualIdeas: segment.visualIdeas,
          emotion: segment.emotion,
          narrativeFunction: segment.narrativeFunction,
        },
        { exclude: bans, rejectedMomentIds: rejected },
      );
      retrievedBySegment.set(segment.id, retrieved);
      for (const candidate of retrieved) allMomentIds.add(candidate.momentId);
    }

    const momentRows =
      allMomentIds.size > 0
        ? await ctx.db.query.moments.findMany({
            where: inArray(momentsTable.id, Array.from(allMomentIds)),
          })
        : [];
    const sceneIds = Array.from(new Set(momentRows.map((moment) => moment.sceneId)));
    const sceneRows =
      sceneIds.length > 0
        ? await ctx.db.query.scenes.findMany({ where: inArray(scenesTable.id, sceneIds) })
        : [];
    const visionByScene = new Map(sceneRows.map((scene) => [scene.id, scene.vision]));

    const rankingMoments = new Map<string, MomentForRanking>();
    const diversityMoments = new Map<string, MomentForDiversity>();
    for (const moment of momentRows) {
      rankingMoments.set(moment.id, {
        durationMs: moment.durationMs,
        primaryEmotion: moment.primaryEmotion,
        visualEnergy: moment.visualEnergy,
        qualityScore: moment.qualityScore,
        metadata: moment.metadata,
      });
      const vision = visionByScene.get(moment.sceneId) ?? null;
      const memeFunctions =
        toMemeFunctions(moment.metadata.memeFunctions) ?? vision?.memeFunctions ?? [];
      const subjects = vision?.subjects.map((subject) => subject.description) ?? [];
      diversityMoments.set(moment.id, { memeFunctions, subjects });
    }

    const diversityContext = createDiversityContext();
    const previouslyShortlisted = new Set<string>();
    const matches: SegmentMatchInput[] = [];
    const debugSegments: Record<string, unknown>[] = [];

    const usageSummary = (momentId: string) => {
      const usage = feedback.usage.get(momentId);
      return usage
        ? { wins: usage.wins, losses: usage.losses, projects: usage.projects.size }
        : null;
    };

    for (const segment of segments) {
      const retrieved = retrievedBySegment.get(segment.id) ?? [];
      const ranked = rankCandidates({
        candidates: retrieved,
        moments: rankingMoments,
        segment: {
          startMs: segment.startMs,
          endMs: segment.endMs,
          emotion: segment.emotion,
          narrativeFunction: segment.narrativeFunction,
          energy: segment.energy,
        },
        previouslyShortlisted,
        usage: feedback.usage,
        projectId,
      });

      const rankedInput: SegmentRankedInput = {
        segmentId: segment.id,
        narrativeFunction: segment.narrativeFunction,
        ranked,
      };
      const shortlist = diversifySegment(rankedInput, diversityMoments, diversityContext);
      for (const entry of shortlist) previouslyShortlisted.add(entry.momentId);

      matches.push({ segmentId: segment.id, retrieved, ranked, shortlist });
      debugSegments.push({
        segmentId: segment.id,
        segmentDurationMs: segment.endMs - segment.startMs,
        queries: segment.visualIdeas,
        rejectedMomentIds: [
          ...(feedback.rejectedBySegment.get(rejectionKey(projectId, segment.id)) ?? []),
        ],
        retrieved,
        ranked: ranked.map((entry) => ({
          ...entry,
          momentDurationMs: rankingMoments.get(entry.momentId)?.durationMs ?? null,
          usage: usageSummary(entry.momentId),
        })),
        shortlist: shortlist.map((entry) => ({
          ...entry,
          momentDurationMs: rankingMoments.get(entry.momentId)?.durationMs ?? null,
        })),
      });
    }

    // Matches and the DIRECTOR follow-up commit together with the job
    // completion (F10), only while this attempt owns the job and its generation
    // is current (F08/F09). The Timeline Director (spec section 31) only needs
    // the shortlists persisted here, never the raw catalog.
    const published = await ctx.publish(async ({ tx, enqueue }) => {
      const rows = await replaceSegmentMatches(tx, {
        projectId,
        matches,
        ranker: RANKER_NAME,
        rankerVersion: RANKER_VERSION,
        feedbackCutoffAt: feedback.cutoffAt,
      });
      await enqueue({ type: 'DIRECTOR', entityId: projectId, input: { projectId } });
      return {
        projectId,
        segmentCount: rows.length,
        shortlistCount: rows.reduce((sum, row) => sum + row.shortlist.length, 0),
      };
    });

    const debugFile = matchDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          ranker: RANKER_NAME,
          rankerVersion: RANKER_VERSION,
          feedback: {
            eventCount: feedback.eventCount,
            cutoffAt: feedback.cutoffAt?.toISOString() ?? null,
            bannedMoments: bans.momentIds.size,
            bannedAssets: bans.assetIds.size,
            excludedRanges: [...bans.excludedRanges.values()].reduce((n, r) => n + r.length, 0),
          },
          segments: debugSegments,
        },
        null,
        2,
      ),
    );

    ctx.logger.info('match_completed', {
      projectId,
      segmentCount: published.segmentCount,
      shortlistCount: published.shortlistCount,
      feedbackEvents: feedback.eventCount,
    });

    return published;
  };
}
