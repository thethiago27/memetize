import {
  createTestDatabase,
  type Database,
  narrativeSegments,
  projectAudio,
  projects,
  segmentMatches,
  timelineVersions,
  truncateAll,
} from '@memetize/database';
import { claimNextJob, completeJob, enqueueJob, listJobsForEntity } from '@memetize/job-system';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listSegmentMatches } from './match';
import { listNarrativeSegments } from './narrative';
import { reprocessProject } from './reprocess';

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

describe.skipIf(!handle)('reprocessProject (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('reprocessing from "narrative" drops the old NARRATIVE job and enqueues a fresh one, without touching audio/lyrics', async () => {
    const projectId = 'prj_reprocess_narrative';
    await seedProjectWithAudio(db, projectId);

    const { job: original } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, original.id, { segmentCount: 3 });

    await reprocessProject(db, projectId, 'narrative');

    const jobs = await listJobsForEntity(db, projectId);
    const narrativeJobs = jobs.filter((job) => job.type === 'NARRATIVE');
    expect(narrativeJobs).toHaveLength(1);
    expect(narrativeJobs[0]?.id).not.toBe(original.id);
    expect(narrativeJobs[0]?.status).toBe('PENDING');
  });

  it('reprocessing from "lyrics" drops a completed downstream NARRATIVE job but leaves AUDIO_ANALYZE alone', async () => {
    const projectId = 'prj_reprocess_lyrics';
    await seedProjectWithAudio(db, projectId);

    const { job: audioJob } = await enqueueJob(db, {
      type: 'AUDIO_ANALYZE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['AUDIO_ANALYZE'] });
    await completeJob(db, audioJob.id, {});

    const { job: lyricsJob } = await enqueueJob(db, {
      type: 'LYRICS',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['LYRICS'] });
    await completeJob(db, lyricsJob.id, {});

    const { job: narrativeJob } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, narrativeJob.id, {});

    await reprocessProject(db, projectId, 'lyrics');

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.some((job) => job.type === 'NARRATIVE')).toBe(false);
    const audioJobs = jobs.filter((job) => job.type === 'AUDIO_ANALYZE');
    expect(audioJobs).toHaveLength(1);
    expect(audioJobs[0]?.id).toBe(audioJob.id);
    expect(audioJobs[0]?.status).toBe('COMPLETED');
    const lyricsJobs = jobs.filter((job) => job.type === 'LYRICS');
    expect(lyricsJobs).toHaveLength(1);
    expect(lyricsJobs[0]?.id).not.toBe(lyricsJob.id);
    expect(lyricsJobs[0]?.status).toBe('PENDING');
  });

  it('reprocessing from "narrative" also drops a completed downstream MATCH job', async () => {
    const projectId = 'prj_reprocess_narrative_match';
    await seedProjectWithAudio(db, projectId);

    const { job: narrativeJob } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, narrativeJob.id, { segmentCount: 3 });

    const { job: matchJob } = await enqueueJob(db, {
      type: 'MATCH',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['MATCH'] });
    await completeJob(db, matchJob.id, { shortlistCount: 9 });

    const { job: directorJob } = await enqueueJob(db, {
      type: 'DIRECTOR',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['DIRECTOR'] });
    await completeJob(db, directorJob.id, { version: 1, clipCount: 3 });

    await reprocessProject(db, projectId, 'narrative');

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.some((job) => job.type === 'MATCH')).toBe(false);
    expect(jobs.some((job) => job.type === 'DIRECTOR')).toBe(false);
    const narrativeJobs = jobs.filter((job) => job.type === 'NARRATIVE');
    expect(narrativeJobs).toHaveLength(1);
    expect(narrativeJobs[0]?.id).not.toBe(narrativeJob.id);
    expect(narrativeJobs[0]?.status).toBe('PENDING');
  });

  it('reprocessing from "match" drops only the MATCH job and re-enqueues it, without touching narrative', async () => {
    const projectId = 'prj_reprocess_match';
    await seedProjectWithAudio(db, projectId);

    const { job: narrativeJob } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, narrativeJob.id, { segmentCount: 3 });

    const { job: matchJob } = await enqueueJob(db, {
      type: 'MATCH',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['MATCH'] });
    await completeJob(db, matchJob.id, { shortlistCount: 9 });

    const { job: directorJob } = await enqueueJob(db, {
      type: 'DIRECTOR',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['DIRECTOR'] });
    await completeJob(db, directorJob.id, { version: 1, clipCount: 3 });

    await reprocessProject(db, projectId, 'match');

    const jobs = await listJobsForEntity(db, projectId);
    const narrativeJobs = jobs.filter((job) => job.type === 'NARRATIVE');
    expect(narrativeJobs).toHaveLength(1);
    expect(narrativeJobs[0]?.id).toBe(narrativeJob.id);
    expect(narrativeJobs[0]?.status).toBe('COMPLETED');

    const matchJobs = jobs.filter((job) => job.type === 'MATCH');
    expect(matchJobs).toHaveLength(1);
    expect(matchJobs[0]?.id).not.toBe(matchJob.id);
    expect(matchJobs[0]?.status).toBe('PENDING');
    expect(jobs.some((job) => job.type === 'DIRECTOR')).toBe(false);
  });

  it('reprocessing from "director" drops DIRECTOR, TIMING, EFFECTS and RENDER and leaves narrative, matches, and their rows', async () => {
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

    const { job: narrativeJob } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, narrativeJob.id, { segmentCount: 1 });

    const { job: matchJob } = await enqueueJob(db, {
      type: 'MATCH',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['MATCH'] });
    await completeJob(db, matchJob.id, { shortlistCount: 0 });

    const { job: directorJob } = await enqueueJob(db, {
      type: 'DIRECTOR',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['DIRECTOR'] });
    await completeJob(db, directorJob.id, { version: 1, clipCount: 0 });

    const { job: timingJob } = await enqueueJob(db, {
      type: 'TIMING',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['TIMING'] });
    await completeJob(db, timingJob.id, { version: 2, clipsAdjusted: 0 });

    const { job: effectsJob } = await enqueueJob(db, {
      type: 'EFFECTS',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['EFFECTS'] });
    await completeJob(db, effectsJob.id, { version: 3, clipsWithEffects: 0 });

    const { job: renderJob } = await enqueueJob(db, {
      type: 'RENDER',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['RENDER'] });
    await completeJob(db, renderJob.id, { version: 1 });

    await reprocessProject(db, projectId, 'director');

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.find((job) => job.type === 'NARRATIVE')?.id).toBe(narrativeJob.id);
    expect(jobs.find((job) => job.type === 'MATCH')?.id).toBe(matchJob.id);
    const directorJobs = jobs.filter((job) => job.type === 'DIRECTOR');
    expect(directorJobs).toHaveLength(1);
    expect(directorJobs[0]?.id).not.toBe(directorJob.id);
    expect(directorJobs[0]?.status).toBe('PENDING');
    expect(jobs.some((job) => job.type === 'TIMING')).toBe(false);
    expect(jobs.some((job) => job.type === 'EFFECTS')).toBe(false);
    expect(jobs.some((job) => job.type === 'RENDER')).toBe(false);

    expect(await listNarrativeSegments(db, projectId)).toHaveLength(1);
    expect(await listSegmentMatches(db, projectId)).toHaveLength(1);
  });

  it('reprocessing from "timing" drops TIMING, EFFECTS and RENDER, leaving the Director\'s raw timeline version intact', async () => {
    const projectId = 'prj_reprocess_timing';
    await seedProjectWithAudio(db, projectId);

    await db.insert(timelineVersions).values({
      id: 'tlv_reprocess_timing_1',
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
    });

    const { job: directorJob } = await enqueueJob(db, {
      type: 'DIRECTOR',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['DIRECTOR'] });
    await completeJob(db, directorJob.id, { version: 1, clipCount: 0 });

    const { job: timingJob } = await enqueueJob(db, {
      type: 'TIMING',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['TIMING'] });
    await completeJob(db, timingJob.id, { version: 2, clipsAdjusted: 0 });

    const { job: effectsJob } = await enqueueJob(db, {
      type: 'EFFECTS',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['EFFECTS'] });
    await completeJob(db, effectsJob.id, { version: 3, clipsWithEffects: 0 });

    const { job: renderJob } = await enqueueJob(db, {
      type: 'RENDER',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['RENDER'] });
    await completeJob(db, renderJob.id, { version: 1 });

    await reprocessProject(db, projectId, 'timing');

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.find((job) => job.type === 'DIRECTOR')?.id).toBe(directorJob.id);
    const timingJobs = jobs.filter((job) => job.type === 'TIMING');
    expect(timingJobs).toHaveLength(1);
    expect(timingJobs[0]?.id).not.toBe(timingJob.id);
    expect(timingJobs[0]?.status).toBe('PENDING');
    expect(jobs.some((job) => job.type === 'EFFECTS')).toBe(false);
    expect(jobs.some((job) => job.type === 'RENDER')).toBe(false);

    const timelines = await db.query.timelineVersions.findMany({
      where: (t, { eq }) => eq(t.projectId, projectId),
    });
    expect(timelines).toHaveLength(1);
    expect(timelines[0]?.version).toBe(1);
  });

  it('reprocessing from "effects" drops only EFFECTS and RENDER, leaving the timed timeline version intact', async () => {
    const projectId = 'prj_reprocess_effects';
    await seedProjectWithAudio(db, projectId);

    await db.insert(timelineVersions).values({
      id: 'tlv_reprocess_effects_1',
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
      timingOptimizer: 'heuristic',
      timingOptimizerVersion: '1.0.0',
    });

    const { job: directorJob } = await enqueueJob(db, {
      type: 'DIRECTOR',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['DIRECTOR'] });
    await completeJob(db, directorJob.id, { version: 1, clipCount: 0 });

    const { job: timingJob } = await enqueueJob(db, {
      type: 'TIMING',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['TIMING'] });
    await completeJob(db, timingJob.id, { version: 2, clipsAdjusted: 0 });

    const { job: effectsJob } = await enqueueJob(db, {
      type: 'EFFECTS',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['EFFECTS'] });
    await completeJob(db, effectsJob.id, { version: 3, clipsWithEffects: 0 });

    const { job: renderJob } = await enqueueJob(db, {
      type: 'RENDER',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['RENDER'] });
    await completeJob(db, renderJob.id, { version: 1 });

    await reprocessProject(db, projectId, 'effects');

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.find((job) => job.type === 'DIRECTOR')?.id).toBe(directorJob.id);
    expect(jobs.find((job) => job.type === 'TIMING')?.id).toBe(timingJob.id);
    const effectsJobs = jobs.filter((job) => job.type === 'EFFECTS');
    expect(effectsJobs).toHaveLength(1);
    expect(effectsJobs[0]?.id).not.toBe(effectsJob.id);
    expect(effectsJobs[0]?.status).toBe('PENDING');
    expect(jobs.some((job) => job.type === 'RENDER')).toBe(false);

    const timelines = await db.query.timelineVersions.findMany({
      where: (t, { eq }) => eq(t.projectId, projectId),
    });
    expect(timelines).toHaveLength(1);
    expect(timelines[0]?.version).toBe(1);
    expect(timelines[0]?.timingOptimizer).toBe('heuristic');
  });

  it('reprocessing from "render" drops only RENDER and re-enqueues it, leaving the timeline intact', async () => {
    const projectId = 'prj_reprocess_render';
    await seedProjectWithAudio(db, projectId);

    await db.insert(timelineVersions).values({
      id: 'tlv_reprocess_render_1',
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
    });

    const { job: directorJob } = await enqueueJob(db, {
      type: 'DIRECTOR',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['DIRECTOR'] });
    await completeJob(db, directorJob.id, { version: 1, clipCount: 0 });

    const { job: renderJob } = await enqueueJob(db, {
      type: 'RENDER',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['RENDER'] });
    await completeJob(db, renderJob.id, { version: 1 });

    await reprocessProject(db, projectId, 'render');

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.find((job) => job.type === 'DIRECTOR')?.id).toBe(directorJob.id);
    const renderJobs = jobs.filter((job) => job.type === 'RENDER');
    expect(renderJobs).toHaveLength(1);
    expect(renderJobs[0]?.id).not.toBe(renderJob.id);
    expect(renderJobs[0]?.status).toBe('PENDING');

    const timelines = await db.query.timelineVersions.findMany({
      where: (t, { eq }) => eq(t.projectId, projectId),
    });
    expect(timelines).toHaveLength(1);
  });
});
