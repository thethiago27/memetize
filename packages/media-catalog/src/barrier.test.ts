import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  ensureEntityExecution,
  startGeneration,
} from '@memetize/job-system';
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
    await ensureEntityExecution(db, 'asset', assetId);
    const generationId = await startGeneration(db, 'asset', assetId);
    const { job: frameJob } = await enqueueJob(db, {
      type: 'FRAME_EXTRACT',
      entityId: assetId,
      input: {},
      generationId,
    });
    const { job: transcriptJob } = await enqueueJob(db, {
      type: 'TRANSCRIPT',
      entityId: assetId,
      input: {},
      generationId,
    });

    await claimNextJob(db, { entityId: assetId, types: ['FRAME_EXTRACT'] });
    await completeJob(db, frameJob.id, {});

    // TRANSCRIPT is still pending: no VISION_ANALYZE yet.
    expect(
      await db.transaction((tx) =>
        maybeEnqueueVisionAnalysis(tx, assetId, 'FRAME_EXTRACT', generationId),
      ),
    ).toBeNull();

    await claimNextJob(db, { entityId: assetId, types: ['TRANSCRIPT'] });
    await completeJob(db, transcriptJob.id, {});

    // Both are COMPLETED now: VISION_ANALYZE is created exactly once.
    const created = await db.transaction((tx) =>
      maybeEnqueueVisionAnalysis(tx, assetId, 'TRANSCRIPT', generationId),
    );
    expect(created?.created).toBe(true);
    expect(created?.job.generationId).toBe(generationId);

    const again = await db.transaction((tx) =>
      maybeEnqueueVisionAnalysis(tx, assetId, 'TRANSCRIPT', generationId),
    );
    expect(again?.created).toBe(false);
    expect(again?.job.id).toBe(created?.job.id);
  });

  it('works for legacy jobs without a generation', async () => {
    const assetId = 'ast_barrier_legacy';
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
    await claimNextJob(db, { entityId: assetId, types: ['TRANSCRIPT'] });
    await completeJob(db, transcriptJob.id, {});

    const created = await db.transaction((tx) =>
      maybeEnqueueVisionAnalysis(tx, assetId, 'TRANSCRIPT', null),
    );
    expect(created?.created).toBe(true);
    expect(created?.job.generationId).toBeNull();
  });
});
