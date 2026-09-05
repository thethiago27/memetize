import {
  createTestDatabase,
  type Database,
  type JobRow,
  narrativeSegments,
  projectAudio,
  projects,
  segmentMatches,
  timelineVersions,
  truncateAll,
} from '@memetize/database';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  getActiveGeneration,
  listJobsForEntity,
} from '@memetize/job-system';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ProjectBusyError } from './busy';
import { listSegmentMatches } from './match';
import { listNarrativeSegments } from './narrative';
import { reprocessProject } from './reprocess';
import { insertEditWindow } from './window';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProjectWithAudio(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'ANALYZING_AUDIO' });
  await db.insert(projectAudio).values({
    projectId: id,
    originalPath: `storage/audio/${id}/original.mp3`,
    lyricsPath: `storage/audio/${id}/lyrics.lrc`,
    checksum: 'checksum',
    durationMs: 4000,
  });
}

type StageType = JobRow['type'];

/** Enqueues a legacy (generation-less) job and completes it, like history written before F09. */
async function completed(projectId: string, type: StageType, result: Record<string, unknown> = {}) {
  const { job } = await enqueueJob(db, { type, entityId: projectId, input: { projectId } });
  await claimNextJob(db, { entityId: projectId, types: [type] });
  await completeJob(db, job.id, result);
  return job;
}

function ofType(jobs: JobRow[], type: StageType): JobRow[] {
  return jobs.filter((job) => job.type === type);
}

/** The most recent job of a type: what the Studio's stepper shows. */
function latestOfType(jobs: JobRow[], type: StageType): JobRow | undefined {
  return ofType(jobs, type).at(-1);
}

async function seedRawTimeline(projectId: string, id: string, timing = false) {
  await db.insert(timelineVersions).values({
    id,
    projectId,
    version: 1,
    data: {
      schemaVersion: '1.0',
      projectId,
      canvas: { width: 1080, height: 1920, fps: 30 },
      audio: { path: 'a.mp3', timelineStartMs: 0, sourceStartMs: 0, volume: 1 },
      durationMs: 4000,
      clips: [],
    },
    director: 'fixture',
    directorVersion: '1.0.0',
    promptVersion: '1.0.0',
    ...(timing ? { timingOptimizer: 'heuristic', timingOptimizerVersion: '1.0.0' } : {}),
  });
}

describe.skipIf(!handle)('reprocessProject (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('refuses to reprocess while one of the stage jobs is RUNNING (F09)', async () => {
    const projectId = 'prj_reprocess_busy';
    await seedProjectWithAudio(db, projectId);
    await enqueueJob(db, { type: 'NARRATIVE', entityId: projectId, input: { projectId } });
    // Claim it to RUNNING but do not complete it.
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });

    await expect(reprocessProject(db, projectId, 'narrative')).rejects.toBeInstanceOf(
      ProjectBusyError,
    );
    // The running job was neither deleted nor cancelled.
    const jobs = await listJobsForEntity(db, projectId);
    expect(ofType(jobs, 'NARRATIVE').filter((job) => job.status === 'RUNNING')).toHaveLength(1);
  });

  it('starts a new generation and enqueues a fresh NARRATIVE for it, keeping the old job as history', async () => {
    const projectId = 'prj_reprocess_narrative';
    await seedProjectWithAudio(db, projectId);
    const original = await completed(projectId, 'NARRATIVE', { segmentCount: 3 });

    const outcome = await reprocessProject(db, projectId, 'narrative');

    expect(await getActiveGeneration(db, 'project', projectId)).toBe(outcome.generationId);
    const jobs = await listJobsForEntity(db, projectId);
    const narrativeJobs = ofType(jobs, 'NARRATIVE');
    // History is kept (F09): the COMPLETED run stays, a new PENDING one is added.
    expect(narrativeJobs).toHaveLength(2);
    expect(narrativeJobs[0]?.id).toBe(original.id);
    expect(narrativeJobs[0]?.status).toBe('COMPLETED');
    const fresh = latestOfType(jobs, 'NARRATIVE');
    expect(fresh?.id).not.toBe(original.id);
    expect(fresh?.status).toBe('PENDING');
    expect(fresh?.generationId).toBe(outcome.generationId);
    expect(fresh?.stepKey).toBe('narrative');
    // The generation is part of the payload, hence of the idempotency hash.
    expect(fresh?.payload).toMatchObject({ projectId, generationId: outcome.generationId });
  });

  it('cancels PENDING downstream jobs of the superseded stages instead of deleting them', async () => {
    const projectId = 'prj_reprocess_cancel';
    await seedProjectWithAudio(db, projectId);
    await completed(projectId, 'NARRATIVE');
    const { job: pendingMatch } = await enqueueJob(db, {
      type: 'MATCH',
      entityId: projectId,
      input: { projectId },
    });

    await reprocessProject(db, projectId, 'narrative');

    const jobs = await listJobsForEntity(db, projectId);
    const match = jobs.find((job) => job.id === pendingMatch.id);
    expect(match?.status).toBe('CANCELLED');
    expect(match?.errorCode).toBe('SUPERSEDED');
  });

  it('reprocessing from "lyrics" leaves AUDIO_ANALYZE alone and keeps downstream history', async () => {
    const projectId = 'prj_reprocess_lyrics';
    await seedProjectWithAudio(db, projectId);
    const audioJob = await completed(projectId, 'AUDIO_ANALYZE');
    const lyricsJob = await completed(projectId, 'LYRICS');
    const narrativeJob = await completed(projectId, 'NARRATIVE');

    const outcome = await reprocessProject(db, projectId, 'lyrics');

    const jobs = await listJobsForEntity(db, projectId);
    // Untouched sibling: exactly the one COMPLETED row.
    expect(ofType(jobs, 'AUDIO_ANALYZE')).toEqual([expect.objectContaining({ id: audioJob.id })]);
    // Downstream history stays COMPLETED; the new generation will re-run it.
    expect(jobs.find((job) => job.id === narrativeJob.id)?.status).toBe('COMPLETED');
    const fresh = latestOfType(jobs, 'LYRICS');
    expect(fresh?.id).not.toBe(lyricsJob.id);
    expect(fresh?.status).toBe('PENDING');
    expect(fresh?.generationId).toBe(outcome.generationId);
    expect(fresh?.payload).toMatchObject({
      projectId,
      lyricsPath: `storage/audio/${projectId}/lyrics.lrc`,
      originalPath: `storage/audio/${projectId}/original.mp3`,
      durationMs: 4000,
    });
  });

  it('reprocessing from "director" re-enqueues only DIRECTOR and leaves narrative, matches, and their rows', async () => {
    const projectId = 'prj_reprocess_director';
    await seedProjectWithAudio(db, projectId);

    const segmentId = 'nar_reprocess_director_1';
    await db.insert(narrativeSegments).values({
      id: segmentId,
      projectId,
      startMs: 0,
      endMs: 2000,
      lyrics: 'hello',
      meaning: 'hello',
      emotion: 'joy',
      narrativeFunction: 'verse',
      visualIdeas: ['hello'],
      literalness: 1,
      ironyPotential: 0,
      energy: 0.5,
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    });
    await db.insert(segmentMatches).values({
      id: 'mat_reprocess_director_1',
      projectId,
      segmentId,
      retrieved: [],
      ranked: [],
      shortlist: [],
      ranker: 'fixture',
      rankerVersion: '1.0.0',
    });

    const narrativeJob = await completed(projectId, 'NARRATIVE', { segmentCount: 1 });
    const matchJob = await completed(projectId, 'MATCH', { shortlistCount: 0 });
    const directorJob = await completed(projectId, 'DIRECTOR', { version: 1, clipCount: 0 });
    await completed(projectId, 'TIMING', { version: 2 });
    await completed(projectId, 'EFFECTS', { version: 3 });
    await completed(projectId, 'RENDER', { version: 1 });

    const outcome = await reprocessProject(db, projectId, 'director');

    const jobs = await listJobsForEntity(db, projectId);
    expect(ofType(jobs, 'NARRATIVE')).toEqual([expect.objectContaining({ id: narrativeJob.id })]);
    expect(ofType(jobs, 'MATCH')).toEqual([expect.objectContaining({ id: matchJob.id })]);
    const fresh = latestOfType(jobs, 'DIRECTOR');
    expect(fresh?.id).not.toBe(directorJob.id);
    expect(fresh?.status).toBe('PENDING');
    expect(fresh?.generationId).toBe(outcome.generationId);
    // Only the stage's first job is enqueued; the chain re-creates the rest.
    for (const type of ['TIMING', 'EFFECTS', 'RENDER'] as const) {
      expect(ofType(jobs, type)).toHaveLength(1);
      expect(latestOfType(jobs, type)?.status).toBe('COMPLETED');
    }

    expect(await listNarrativeSegments(db, projectId)).toHaveLength(1);
    expect(await listSegmentMatches(db, projectId)).toHaveLength(1);
  });

  it('reprocessing from "timing" pins the Director\'s raw timeline version as the job input (F11)', async () => {
    const projectId = 'prj_reprocess_timing';
    await seedProjectWithAudio(db, projectId);
    await seedRawTimeline(projectId, 'tlv_reprocess_timing_1');
    const directorJob = await completed(projectId, 'DIRECTOR', { version: 1 });
    const timingJob = await completed(projectId, 'TIMING', { version: 2 });

    const outcome = await reprocessProject(db, projectId, 'timing');

    const jobs = await listJobsForEntity(db, projectId);
    expect(ofType(jobs, 'DIRECTOR')).toEqual([expect.objectContaining({ id: directorJob.id })]);
    const fresh = latestOfType(jobs, 'TIMING');
    expect(fresh?.id).not.toBe(timingJob.id);
    expect(fresh?.status).toBe('PENDING');
    expect(fresh?.payload).toEqual({
      projectId,
      generationId: outcome.generationId,
      sourceTimelineVersion: 1,
    });

    const timelines = await db.query.timelineVersions.findMany({
      where: (t, { eq }) => eq(t.projectId, projectId),
    });
    expect(timelines).toHaveLength(1);
    expect(timelines[0]?.version).toBe(1);
  });

  it('reprocessing from "effects" pins the timed timeline version (F11)', async () => {
    const projectId = 'prj_reprocess_effects';
    await seedProjectWithAudio(db, projectId);
    await seedRawTimeline(projectId, 'tlv_reprocess_effects_1', true);
    await completed(projectId, 'DIRECTOR', { version: 1 });
    await completed(projectId, 'TIMING', { version: 2 });
    const effectsJob = await completed(projectId, 'EFFECTS', { version: 3 });

    const outcome = await reprocessProject(db, projectId, 'effects');

    const jobs = await listJobsForEntity(db, projectId);
    const fresh = latestOfType(jobs, 'EFFECTS');
    expect(fresh?.id).not.toBe(effectsJob.id);
    expect(fresh?.status).toBe('PENDING');
    expect(fresh?.payload).toEqual({
      projectId,
      generationId: outcome.generationId,
      sourceTimelineVersion: 1,
    });
    const timelines = await db.query.timelineVersions.findMany({
      where: (t, { eq }) => eq(t.projectId, projectId),
    });
    expect(timelines).toHaveLength(1);
    expect(timelines[0]?.timingOptimizer).toBe('heuristic');
  });

  it('reprocessing from "render" pins both the timeline and the edit window versions (F11)', async () => {
    const projectId = 'prj_reprocess_render';
    await seedProjectWithAudio(db, projectId);
    await seedRawTimeline(projectId, 'tlv_reprocess_render_1');
    await insertEditWindow(db, {
      projectId,
      selection: {
        sourceStartMs: 0,
        sourceEndMs: 4000,
        durationMs: 4000,
        targetDurationMs: 4000,
        score: 1,
        scoreBreakdown: { section: 1, energy: 1, lyrics: 1, narrativeArc: 1, boundaries: 1 },
        selector: 'fixture',
        selectorVersion: '1.0.0',
      },
    });
    await completed(projectId, 'DIRECTOR', { version: 1 });
    const renderJob = await completed(projectId, 'RENDER', { version: 1 });

    const outcome = await reprocessProject(db, projectId, 'render');

    const jobs = await listJobsForEntity(db, projectId);
    const fresh = latestOfType(jobs, 'RENDER');
    expect(fresh?.id).not.toBe(renderJob.id);
    expect(fresh?.status).toBe('PENDING');
    expect(fresh?.payload).toEqual({
      projectId,
      generationId: outcome.generationId,
      sourceTimelineVersion: 1,
      editWindowVersion: 1,
    });
    const timelines = await db.query.timelineVersions.findMany({
      where: (t, { eq }) => eq(t.projectId, projectId),
    });
    expect(timelines).toHaveLength(1);
  });

  it('two reprocess commands on the same project serialize into two distinct generations', async () => {
    const projectId = 'prj_reprocess_serial';
    await seedProjectWithAudio(db, projectId);
    await completed(projectId, 'NARRATIVE');

    const [first, second] = await Promise.all([
      reprocessProject(db, projectId, 'narrative'),
      reprocessProject(db, projectId, 'narrative'),
    ]);
    expect(first.generationId).not.toBe(second.generationId);
    const active = await getActiveGeneration(db, 'project', projectId);
    expect([first.generationId, second.generationId]).toContain(active);
    // The loser's PENDING job was cancelled by the winner; exactly one PENDING remains.
    const jobs = await listJobsForEntity(db, projectId);
    const pending = ofType(jobs, 'NARRATIVE').filter((job) => job.status === 'PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.generationId).toBe(active);
  });
});
