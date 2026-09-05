import type { Database } from '@memetize/database';
import {
  type EnqueueResult,
  enqueueJob,
  ensureEntityExecution,
  listJobsForEntity,
  lockEntity,
} from '@memetize/job-system';

type BarrierJobType = 'FRAME_EXTRACT' | 'TRANSCRIPT';

const OTHER_TYPE: Record<BarrierJobType, BarrierJobType> = {
  FRAME_EXTRACT: 'TRANSCRIPT',
  TRANSCRIPT: 'FRAME_EXTRACT',
};

/**
 * Fan-in after scene detection (spec section 12): frames and transcript run
 * independently, and vision analysis only starts once both are done.
 *
 * Runs AFTER the completing job is marked COMPLETED (orchestrator post-completion
 * hook), under the per-asset lock (F10), so the last sibling to finish always
 * sees both COMPLETED and enqueues VISION_ANALYZE exactly once; a repeated
 * notification cannot duplicate it (enqueue is idempotent).
 */
export async function maybeEnqueueVisionAnalysis(
  db: Database,
  assetId: string,
  completedType: BarrierJobType,
): Promise<EnqueueResult | null> {
  return db.transaction(async (tx) => {
    await ensureEntityExecution(tx, 'asset', assetId);
    await lockEntity(tx, 'asset', assetId);
    const jobsForAsset = await listJobsForEntity(tx, assetId);
    const other = jobsForAsset.find((job) => job.type === OTHER_TYPE[completedType]);
    if (other?.status !== 'COMPLETED') return null;
    return enqueueJob(tx, { type: 'VISION_ANALYZE', entityId: assetId, input: { assetId } });
  });
}
