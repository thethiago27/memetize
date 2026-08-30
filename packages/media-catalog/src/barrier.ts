import type { Database } from '@memetize/database';
import { type EnqueueResult, enqueueJob, listJobsForEntity } from '@memetize/job-system';

type BarrierJobType = 'FRAME_EXTRACT' | 'TRANSCRIPT';

const OTHER_TYPE: Record<BarrierJobType, BarrierJobType> = {
  FRAME_EXTRACT: 'TRANSCRIPT',
  TRANSCRIPT: 'FRAME_EXTRACT',
};

/**
 * Fan-in after scene detection (spec section 12): frames and transcript run
 * independently, and vision analysis only starts once both are done. Each
 * side calls this after finishing its own work, checking the *other* type's
 * job status rather than its own — the orchestrator only marks a job
 * COMPLETED after the handler returns, so reading "self" here would always
 * see a stale, non-terminal status.
 */
export async function maybeEnqueueVisionAnalysis(
  db: Database,
  assetId: string,
  completedType: BarrierJobType,
): Promise<EnqueueResult | null> {
  const jobsForAsset = await listJobsForEntity(db, assetId);
  const other = jobsForAsset.find((job) => job.type === OTHER_TYPE[completedType]);
  if (other?.status !== 'COMPLETED') return null;
  return enqueueJob(db, { type: 'VISION_ANALYZE', entityId: assetId, input: { assetId } });
}
