import type { Database } from '@memetize/database';
import {
  type EnqueueResult,
  enqueueJob,
  ensureEntityExecution,
  listJobsForEntity,
  lockEntity,
} from '@memetize/job-system';

type BarrierJobType = 'AUDIO_ANALYZE' | 'LYRICS';

const OTHER_TYPE: Record<BarrierJobType, BarrierJobType> = {
  AUDIO_ANALYZE: 'LYRICS',
  LYRICS: 'AUDIO_ANALYZE',
};

/**
 * Fan-in after project ingest (spec section 24): audio analysis and lyrics run
 * independently, and the narrative analyzer only starts once both are done.
 *
 * This runs AFTER the completing job is marked COMPLETED (from the orchestrator's
 * post-completion hook, not from inside the handler), under the per-project lock
 * (F10). Serializing on the lock and reading committed completion state means the
 * last sibling to finish always sees both siblings COMPLETED and enqueues exactly
 * once; the earlier sibling's check sees the other still running and does nothing.
 * Enqueue is idempotent, so a repeated notification cannot duplicate NARRATIVE.
 */
export async function maybeEnqueueNarrative(
  db: Database,
  projectId: string,
  completedType: BarrierJobType,
): Promise<EnqueueResult | null> {
  return db.transaction(async (tx) => {
    await ensureEntityExecution(tx, 'project', projectId);
    await lockEntity(tx, 'project', projectId);
    const jobsForProject = await listJobsForEntity(tx, projectId);
    const other = jobsForProject.find((job) => job.type === OTHER_TYPE[completedType]);
    if (other?.status !== 'COMPLETED') return null;
    return enqueueJob(tx, { type: 'NARRATIVE', entityId: projectId, input: { projectId } });
  });
}
