import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { claimNextJob, completeJob, enqueueJob } from '@memetize/job-system';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { maybeEnqueueVisionAnalysis } from './barrier';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('maybeEnqueueVisionAnalysis (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('waits for both FRAME_EXTRACT and TRANSCRIPT before enqueuing VISION_ANALYZE, exactly once', async () => {
    const assetId = 'ast_barrier';
    const { job: frameJob } = await enqueueJob(db, {
      type: 'FRAME_EXTRACT',
      entityId: assetId,
      input: {},
    });
    const { job: transcriptJob } = await enqueueJob(db, {
      type: 'TRANSCRIPT',
      entityId: assetId,
      input: {},
    });

    await claimNextJob(db, { entityId: assetId, types: ['FRAME_EXTRACT'] });
    await completeJob(db, frameJob.id, {});

    // TRANSCRIPT is still pending: no VISION_ANALYZE yet.
    expect(await maybeEnqueueVisionAnalysis(db, assetId, 'FRAME_EXTRACT')).toBeNull();

    await claimNextJob(db, { entityId: assetId, types: ['TRANSCRIPT'] });
    await completeJob(db, transcriptJob.id, {});

    // Both are COMPLETED now: VISION_ANALYZE is created exactly once.
    const created = await maybeEnqueueVisionAnalysis(db, assetId, 'TRANSCRIPT');
    expect(created?.created).toBe(true);

    const again = await maybeEnqueueVisionAnalysis(db, assetId, 'TRANSCRIPT');
    expect(again?.created).toBe(false);
    expect(again?.job.id).toBe(created?.job.id);
  });
});
