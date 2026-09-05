import { createTestDatabase, type Database, jobs, truncateAll } from '@memetize/database';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  ensureEntityExecution,
  startGeneration,
  stepKeyFor,
} from '@memetize/job-system';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { maybeEnqueueNarrative, maybeEnqueueSubtitles } from './barrier';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function runToCompletion(projectId: string, jobId: string, type: 'AUDIO_ANALYZE' | 'LYRICS') {
  await claimNextJob(db, { entityId: projectId, types: [type] });
  await completeJob(db, jobId, {});
}

describe.skipIf(!handle)('maybeEnqueueNarrative (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('waits for both AUDIO_ANALYZE and LYRICS before enqueuing NARRATIVE, exactly once (legacy jobs)', async () => {
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

    await runToCompletion(projectId, audioJob.id, 'AUDIO_ANALYZE');

    // LYRICS is still pending: no NARRATIVE yet.
    expect(
      await db.transaction((tx) => maybeEnqueueNarrative(tx, projectId, 'AUDIO_ANALYZE', null)),
    ).toBeNull();

    await runToCompletion(projectId, lyricsJob.id, 'LYRICS');

    // Both are COMPLETED now: NARRATIVE is created exactly once.
    const created = await db.transaction((tx) =>
      maybeEnqueueNarrative(tx, projectId, 'LYRICS', null),
    );
    expect(created?.created).toBe(true);

    const again = await db.transaction((tx) =>
      maybeEnqueueNarrative(tx, projectId, 'LYRICS', null),
    );
    expect(again?.created).toBe(false);
    expect(again?.job.id).toBe(created?.job.id);
  });

  it('creates exactly one NARRATIVE when both siblings finish simultaneously (F10)', async () => {
    const projectId = 'prj_barrier_race';
    await ensureEntityExecution(db, 'project', projectId);
    const generationId = await startGeneration(db, 'project', projectId);
    const { job: audioJob } = await enqueueJob(db, {
      type: 'AUDIO_ANALYZE',
      entityId: projectId,
      input: {},
      generationId,
    });
    const { job: lyricsJob } = await enqueueJob(db, {
      type: 'LYRICS',
      entityId: projectId,
      input: {},
      generationId,
    });
    // Both siblings are already COMPLETED; the two continuation evaluations race.
    await runToCompletion(projectId, audioJob.id, 'AUDIO_ANALYZE');
    await runToCompletion(projectId, lyricsJob.id, 'LYRICS');

    const results = await Promise.all([
      db.transaction((tx) => maybeEnqueueNarrative(tx, projectId, 'AUDIO_ANALYZE', generationId)),
      db.transaction((tx) => maybeEnqueueNarrative(tx, projectId, 'LYRICS', generationId)),
    ]);
    // At least one enqueued; the entity lock serializes them so no duplicate.
    expect(results.some((r) => r?.created)).toBe(true);
    const narrativeJobs = await db
      .select({ id: jobs.id, generationId: jobs.generationId, stepKey: jobs.stepKey })
      .from(jobs)
      .where(and(eq(jobs.entityId, projectId), eq(jobs.type, 'NARRATIVE')));
    expect(narrativeJobs).toHaveLength(1);
    expect(narrativeJobs[0]).toMatchObject({ generationId, stepKey: stepKeyFor('NARRATIVE') });
  });

  it('never satisfies the barrier with a sibling from another generation that this generation re-ran (F10/F11)', async () => {
    const projectId = 'prj_barrier_gen';
    await ensureEntityExecution(db, 'project', projectId);
    const first = await startGeneration(db, 'project', projectId);
    const { job: oldLyrics } = await enqueueJob(db, {
      type: 'LYRICS',
      entityId: projectId,
      input: {},
      generationId: first,
    });
    await runToCompletion(projectId, oldLyrics.id, 'LYRICS');

    // Second generation re-runs both siblings; only audio has finished.
    const second = await startGeneration(db, 'project', projectId);
    const { job: audio } = await enqueueJob(db, {
      type: 'AUDIO_ANALYZE',
      entityId: projectId,
      input: {},
      generationId: second,
    });
    await enqueueJob(db, { type: 'LYRICS', entityId: projectId, input: {}, generationId: second });
    await runToCompletion(projectId, audio.id, 'AUDIO_ANALYZE');

    // The old generation's COMPLETED lyrics must not stand in for the pending one.
    expect(
      await db.transaction((tx) => maybeEnqueueNarrative(tx, projectId, 'AUDIO_ANALYZE', second)),
    ).toBeNull();
  });

  it('inherits a sibling the generation did not re-run (reprocess --from lyrics)', async () => {
    const projectId = 'prj_barrier_inherit';
    await ensureEntityExecution(db, 'project', projectId);
    const first = await startGeneration(db, 'project', projectId);
    const { job: audio } = await enqueueJob(db, {
      type: 'AUDIO_ANALYZE',
      entityId: projectId,
      input: {},
      generationId: first,
    });
    await runToCompletion(projectId, audio.id, 'AUDIO_ANALYZE');

    const second = await startGeneration(db, 'project', projectId);
    const { job: lyrics } = await enqueueJob(db, {
      type: 'LYRICS',
      entityId: projectId,
      input: {},
      generationId: second,
    });
    await runToCompletion(projectId, lyrics.id, 'LYRICS');

    const created = await db.transaction((tx) =>
      maybeEnqueueNarrative(tx, projectId, 'LYRICS', second),
    );
    expect(created?.created).toBe(true);
    expect(created?.job.generationId).toBe(second);
  });

  it('enqueues SUBTITLES once per generation after LYRICS', async () => {
    const projectId = 'prj_barrier_subtitles';
    await ensureEntityExecution(db, 'project', projectId);
    const generationId = await startGeneration(db, 'project', projectId);
    const first = await db.transaction((tx) => maybeEnqueueSubtitles(tx, projectId, generationId));
    const second = await db.transaction((tx) => maybeEnqueueSubtitles(tx, projectId, generationId));
    expect(first?.created).toBe(true);
    expect(second?.created).toBe(false);
    expect(first?.job.stepKey).toBe(stepKeyFor('SUBTITLES'));
    expect(first?.job.payload).toEqual({ projectId, generationId });
    const subtitleJobs = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.entityId, projectId), eq(jobs.type, 'SUBTITLES')));
    expect(subtitleJobs).toHaveLength(1);
  });
});
