import type { Executor } from '@memetize/database';
import {
  type EnqueueResult,
  enqueueJob,
  isStepSatisfied,
  listJobsForEntity,
  stepKeyFor,
} from '@memetize/job-system';
import { lockProject } from './coordinate';

type BarrierJobType = 'AUDIO_ANALYZE' | 'LYRICS';

const OTHER_TYPE: Record<BarrierJobType, BarrierJobType> = {
  AUDIO_ANALYZE: 'LYRICS',
  LYRICS: 'AUDIO_ANALYZE',
};

/**
 * Fan-in after project ingest (spec section 24): audio analysis and lyrics run
 * independently, and the narrative analyzer only starts once both are done.
 *
 * Runs INSIDE the completing job's publication transaction (F10), after the job
 * is marked COMPLETED and under the per-project lock, so the decision reads
 * committed-in-this-transaction state and the NARRATIVE enqueue commits with it:
 * a crash can no longer land between "both COMPLETED" and "continuation
 * enqueued". Two siblings finishing together serialize on the lock; the second
 * one sees the first's completion. The enqueue is idempotent per
 * (entity, generation, step), so a repeated notification cannot duplicate it.
 *
 * With a generation, the sibling is satisfied when it COMPLETED in this
 * generation or, when this generation never re-ran it (`reprocess --from lyrics`
 * keeps the previous audio analysis), when the project's most recent job of that
 * type is COMPLETED. Legacy jobs without a generation fall back to "latest job of
 * the sibling type is COMPLETED".
 */
export async function maybeEnqueueNarrative(
  tx: Executor,
  projectId: string,
  completedType: BarrierJobType,
  generationId: string | null,
): Promise<EnqueueResult | null> {
  await lockProject(tx, projectId);
  const other = OTHER_TYPE[completedType];
  const satisfied = generationId
    ? await isStepSatisfied(tx, {
        entityId: projectId,
        generationId,
        stepKey: stepKeyFor(other),
        type: other,
      })
    : await latestOfTypeCompleted(tx, projectId, other);
  if (!satisfied) return null;
  return enqueueJob(tx, {
    type: 'NARRATIVE',
    entityId: projectId,
    input: { projectId },
    generationId,
    stepKey: generationId ? stepKeyFor('NARRATIVE') : null,
  });
}

/**
 * SUBTITLES runs after LYRICS, in parallel with NARRATIVE (translated-subtitles
 * spec). Idempotent per (entity, generation, step).
 */
export async function maybeEnqueueSubtitles(
  tx: Executor,
  projectId: string,
  generationId: string | null,
): Promise<EnqueueResult | null> {
  await lockProject(tx, projectId);
  return enqueueJob(tx, {
    type: 'SUBTITLES',
    entityId: projectId,
    input: { projectId },
    generationId,
    stepKey: generationId ? stepKeyFor('SUBTITLES') : null,
  });
}

async function latestOfTypeCompleted(
  tx: Executor,
  projectId: string,
  type: BarrierJobType,
): Promise<boolean> {
  const jobsForProject = await listJobsForEntity(tx, projectId);
  const latest = jobsForProject.filter((job) => job.type === type).at(-1);
  return latest?.status === 'COMPLETED';
}
