import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { claimNextJob, completeJob, enqueueJob, listJobsForEntity } from '@memetize/job-system';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reprocessAsset } from './reprocess';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('reprocessAsset (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('reprocessing from "embeddings" keeps the old EMBED job as history and enqueues a fresh one', async () => {
    const assetId = 'ast_reprocess_embed';
    const { job: original } = await enqueueJob(db, {
      type: 'EMBED',
      entityId: assetId,
      input: { assetId },
    });
    await claimNextJob(db, { entityId: assetId, types: ['EMBED'] });
    await completeJob(db, original.id, { embeddingCount: 3 });

    const { generationId } = await reprocessAsset(db, assetId, 'embeddings');

    const jobs = await listJobsForEntity(db, assetId);
    const embedJobs = jobs.filter((job) => job.type === 'EMBED');
    expect(embedJobs).toHaveLength(2);
    expect(embedJobs[0]?.id).toBe(original.id);
    expect(embedJobs[0]?.status).toBe('COMPLETED');
    expect(embedJobs[1]?.status).toBe('PENDING');
    expect(embedJobs[1]?.generationId).toBe(generationId);
    expect(embedJobs[1]?.payload).toEqual({ assetId, generationId });
  });

  it('reprocessing from "moments" cancels a pending downstream EMBED job and keeps completed history', async () => {
    const assetId = 'ast_reprocess_moments';
    const { job: momentJob } = await enqueueJob(db, {
      type: 'MOMENT_EXTRACT',
      entityId: assetId,
      input: { assetId },
    });
    await claimNextJob(db, { entityId: assetId, types: ['MOMENT_EXTRACT'] });
    await completeJob(db, momentJob.id, { momentCount: 2 });

    const { job: embedJob } = await enqueueJob(db, {
      type: 'EMBED',
      entityId: assetId,
      input: { assetId },
    });

    const { generationId } = await reprocessAsset(db, assetId, 'moments');

    const jobs = await listJobsForEntity(db, assetId);
    // The not-yet-run EMBED is cancelled, not deleted; the new generation re-creates it.
    expect(jobs.find((job) => job.id === embedJob.id)?.status).toBe('CANCELLED');
    const momentJobs = jobs.filter((job) => job.type === 'MOMENT_EXTRACT');
    expect(momentJobs).toHaveLength(2);
    expect(momentJobs[0]?.id).toBe(momentJob.id);
    expect(momentJobs[0]?.status).toBe('COMPLETED');
    expect(momentJobs[1]?.status).toBe('PENDING');
    expect(momentJobs[1]?.generationId).toBe(generationId);
  });
});
