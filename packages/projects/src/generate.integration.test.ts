import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { claimNextJob, completeJob, enqueueJob, listJobsForEntity } from '@memetize/job-system';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTimeline } from './generate';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProject(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'PLANNING' });
}

describe.skipIf(!handle)('generateTimeline (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('rejects a project that has no completed MATCH yet', async () => {
    const projectId = 'prj_generate_no_match';
    await seedProject(db, projectId);

    await expect(generateTimeline(db, projectId)).rejects.toThrow(/completed MATCH/);
  });

  it('rejects a project whose MATCH job is still pending', async () => {
    const projectId = 'prj_generate_pending_match';
    await seedProject(db, projectId);
    await enqueueJob(db, { type: 'MATCH', entityId: projectId, input: { projectId } });

    await expect(generateTimeline(db, projectId)).rejects.toThrow(/completed MATCH/);
  });

  it('enqueues a fresh DIRECTOR job when MATCH is completed and none exists yet', async () => {
    const projectId = 'prj_generate_fresh';
    await seedProject(db, projectId);
    const { job: matchJob } = await enqueueJob(db, {
      type: 'MATCH',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['MATCH'] });
    await completeJob(db, matchJob.id, { shortlistCount: 3 });

    await generateTimeline(db, projectId);

    const jobs = await listJobsForEntity(db, projectId);
    const directorJobs = jobs.filter((job) => job.type === 'DIRECTOR');
    expect(directorJobs).toHaveLength(1);
    expect(directorJobs[0]?.status).toBe('PENDING');
  });

  it('keeps the completed DIRECTOR job as history and enqueues a new one in a fresh generation', async () => {
    const projectId = 'prj_generate_again';
    await seedProject(db, projectId);
    const { job: matchJob } = await enqueueJob(db, {
      type: 'MATCH',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['MATCH'] });
    await completeJob(db, matchJob.id, { shortlistCount: 3 });

    const { job: directorJob } = await enqueueJob(db, {
      type: 'DIRECTOR',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['DIRECTOR'] });
    await completeJob(db, directorJob.id, { version: 1, clipCount: 3 });

    await generateTimeline(db, projectId);

    const jobs = await listJobsForEntity(db, projectId);
    const directorJobs = jobs.filter((job) => job.type === 'DIRECTOR');
    // History is kept (F09): the old COMPLETED run stays, the new run is a new
    // job in the project's new generation, so the same input yields a fresh version.
    expect(directorJobs).toHaveLength(2);
    expect(directorJobs[0]?.id).toBe(directorJob.id);
    expect(directorJobs[0]?.status).toBe('COMPLETED');
    expect(directorJobs[1]?.id).not.toBe(directorJob.id);
    expect(directorJobs[1]?.status).toBe('PENDING');
    expect(directorJobs[1]?.generationId).toBeTruthy();
  });
});
