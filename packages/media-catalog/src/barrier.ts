import type { Executor } from '@memetize/database';
import {
  type EnqueueResult,
  enqueueJob,
  ensureEntityExecution,
  isStepSatisfied,
  listJobsForEntity,
  lockEntity,
  stepKeyFor,
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
 * Runs INSIDE the completing job's publication transaction (F10), after the job
 * is marked COMPLETED and under the per-asset lock, so the VISION_ANALYZE enqueue
 * commits together with the completion that justified it. Two siblings finishing
 * together serialize on the lock. The enqueue is idempotent per (entity,
 * generation, step), so a repeated notification cannot duplicate it. Generation
 * semantics mirror `maybeEnqueueNarrative` in `@memetize/projects`.
 */
export async function maybeEnqueueVisionAnalysis(
  tx: Executor,
  assetId: string,
  completedType: BarrierJobType,
  generationId: string | null,
): Promise<EnqueueResult | null> {
  await ensureEntityExecution(tx, 'asset', assetId);
  await lockEntity(tx, 'asset', assetId);
  const other = OTHER_TYPE[completedType];
  const satisfied = generationId
    ? await isStepSatisfied(tx, {
        entityId: assetId,
        generationId,
        stepKey: stepKeyFor(other),
        type: other,
      })
    : await latestOfTypeCompleted(tx, assetId, other);
  if (!satisfied) return null;
  return enqueueJob(tx, {
    type: 'VISION_ANALYZE',
    entityId: assetId,
    input: { assetId },
    generationId,
    stepKey: generationId ? stepKeyFor('VISION_ANALYZE') : null,
  });
}

async function latestOfTypeCompleted(
  tx: Executor,
  assetId: string,
  type: BarrierJobType,
): Promise<boolean> {
  const jobsForAsset = await listJobsForEntity(tx, assetId);
  const latest = jobsForAsset.filter((job) => job.type === type).at(-1);
  return latest?.status === 'COMPLETED';
}
