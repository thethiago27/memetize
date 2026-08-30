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

  it('reprocessing from "embeddings" drops the old EMBED job and enqueues a fresh one', async () => {
    const assetId = 'ast_reprocess_embed';
    const { job: original } = await enqueueJob(db, {
      type: 'EMBED',
      entityId: assetId,
      input: { assetId },
    });
    await claimNextJob(db, { entityId: assetId, types: ['EMBED'] });
    await completeJob(db, original.id, { embeddingCount: 3 });

    await reprocessAsset(db, assetId, 'embeddings');

    const jobs = await listJobsForEntity(db, assetId);
    const embedJobs = jobs.filter((job) => job.type === 'EMBED');
    expect(embedJobs).toHaveLength(1);
    expect(embedJobs[0]?.id).not.toBe(original.id);
    expect(embedJobs[0]?.status).toBe('PENDING');
  });

  it('reprocessing from "moments" also drops a completed downstream EMBED job', async () => {
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
    await claimNextJob(db, { entityId: assetId, types: ['EMBED'] });
    await completeJob(db, embedJob.id, { embeddingCount: 6 });

    await reprocessAsset(db, assetId, 'moments');

    const jobs = await listJobsForEntity(db, assetId);
    expect(jobs.some((job) => job.type === 'EMBED')).toBe(false);
    const momentJobs = jobs.filter((job) => job.type === 'MOMENT_EXTRACT');
    expect(momentJobs).toHaveLength(1);
    expect(momentJobs[0]?.status).toBe('PENDING');
  });
});
