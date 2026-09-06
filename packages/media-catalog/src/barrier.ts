import type { Executor } from '@memetize/database';
import { type EnqueueResult, maybeEnqueueAfterFanIn } from '@memetize/job-system';

type BarrierJobType = 'FRAME_EXTRACT' | 'TRANSCRIPT';

const SIBLING: Record<BarrierJobType, BarrierJobType> = {
  FRAME_EXTRACT: 'TRANSCRIPT',
  TRANSCRIPT: 'FRAME_EXTRACT',
};

/**
 * Fan-in after scene detection (spec section 12): frames and transcript run
 * independently, and vision analysis only starts once both are done. Shares its
 * mechanics with the project-side barrier through `maybeEnqueueAfterFanIn`.
 */
export async function maybeEnqueueVisionAnalysis(
  tx: Executor,
  assetId: string,
  completedType: BarrierJobType,
  generationId: string | null,
): Promise<EnqueueResult | null> {
  return maybeEnqueueAfterFanIn(tx, {
    kind: 'asset',
    entityId: assetId,
    completedType,
    siblingType: SIBLING[completedType],
    generationId,
    next: { type: 'VISION_ANALYZE', input: { assetId } },
  });
}
