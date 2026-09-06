import type { Executor } from '@memetize/database';
import {
  type EnqueueResult,
  enqueueJob,
  maybeEnqueueAfterFanIn,
  stepKeyFor,
} from '@memetize/job-system';
import { lockProject } from './coordinate';

type BarrierJobType = 'AUDIO_ANALYZE' | 'LYRICS';

const SIBLING: Record<BarrierJobType, BarrierJobType> = {
  AUDIO_ANALYZE: 'LYRICS',
  LYRICS: 'AUDIO_ANALYZE',
};

/**
 * Fan-in after project ingest (spec section 24): audio analysis and lyrics run
 * independently, and the narrative analyzer only starts once both are done.
 * The mechanics live in `maybeEnqueueAfterFanIn`, shared with the asset-side
 * barrier — they were two copies of the same algorithm, so a change to what a
 * barrier means had to be made twice.
 */
export async function maybeEnqueueNarrative(
  tx: Executor,
  projectId: string,
  completedType: BarrierJobType,
  generationId: string | null,
): Promise<EnqueueResult | null> {
  return maybeEnqueueAfterFanIn(tx, {
    kind: 'project',
    entityId: projectId,
    completedType,
    siblingType: SIBLING[completedType],
    generationId,
    next: { type: 'NARRATIVE', input: { projectId } },
  });
}

/**
 * SUBTITLES runs after LYRICS, in parallel with NARRATIVE (translated-subtitles
 * spec). Not a fan-in: one predecessor, so there is no sibling to wait for.
 * Idempotent per (entity, generation, step).
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
    input: { projectId, ...(generationId ? { generationId } : {}) },
    generationId,
    stepKey: generationId ? stepKeyFor('SUBTITLES') : null,
  });
}
