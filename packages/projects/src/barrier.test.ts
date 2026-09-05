import { createTestDatabase, type Database, jobs, truncateAll } from '@memetize/database';
import { claimNextJob, completeJob, enqueueJob } from '@memetize/job-system';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { maybeEnqueueNarrative } from './barrier';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('maybeEnqueueNarrative (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('waits for both AUDIO_ANALYZE and LYRICS before enqueuing NARRATIVE, exactly once', async () => {
    const projectId = 'prj_barrier';
    const { job: audioJob } = await enqueueJob(db, {
      type: 'AUDIO_ANALYZE',
      entityId: projectId,
      input: {},
    });
    const { job: lyricsJob } = await enqueueJob(db, {
      type: 'LYRICS',
      entityId: projectId,
      input: {},
    });

    await claimNextJob(db, { entityId: projectId, types: ['AUDIO_ANALYZE'] });
    await completeJob(db, audioJob.id, {});

    // LYRICS is still pending: no NARRATIVE yet.
    expect(await maybeEnqueueNarrative(db, projectId, 'AUDIO_ANALYZE')).toBeNull();

    await claimNextJob(db, { entityId: projectId, types: ['LYRICS'] });
    await completeJob(db, lyricsJob.id, {});

    // Both are COMPLETED now: NARRATIVE is created exactly once.
    const created = await maybeEnqueueNarrative(db, projectId, 'LYRICS');
    expect(created?.created).toBe(true);

    const again = await maybeEnqueueNarrative(db, projectId, 'LYRICS');
    expect(again?.created).toBe(false);
    expect(again?.job.id).toBe(created?.job.id);
  });

  it('creates exactly one NARRATIVE when both siblings finish simultaneously (F10)', async () => {
    const projectId = 'prj_barrier_race';
    const { job: audioJob } = await enqueueJob(db, {
      type: 'AUDIO_ANALYZE',
      entityId: projectId,
      input: {},
    });
    const { job: lyricsJob } = await enqueueJob(db, {
      type: 'LYRICS',
      entityId: projectId,
      input: {},
    });
    // Both siblings are already COMPLETED; the two post-completion barriers race.
    await claimNextJob(db, { entityId: projectId, types: ['AUDIO_ANALYZE'] });
    await completeJob(db, audioJob.id, {});
    await claimNextJob(db, { entityId: projectId, types: ['LYRICS'] });
    await completeJob(db, lyricsJob.id, {});

    const results = await Promise.all([
      maybeEnqueueNarrative(db, projectId, 'AUDIO_ANALYZE'),
      maybeEnqueueNarrative(db, projectId, 'LYRICS'),
    ]);
    // At least one enqueued; the entity lock serializes them so no duplicate.
    expect(results.some((r) => r?.created)).toBe(true);
    const narrativeJobs = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.entityId, projectId), eq(jobs.type, 'NARRATIVE')));
    expect(narrativeJobs).toHaveLength(1);
  });
});
