import type { JobType } from '@memetize/contracts';
import type { Executor } from '@memetize/database';
import { startReprocess } from '@memetize/job-system';
import { getAsset } from './assets';

export const REPROCESS_STAGES = [
  'frames',
  'transcript',
  'vision',
  'moments',
  'embeddings',
] as const;
export type ReprocessStage = (typeof REPROCESS_STAGES)[number];

/**
 * Jobs superseded by each stage: the stage's own job plus everything
 * downstream. Every earlier stage also supersedes `EMBED` (spec section 40):
 * otherwise the asset would keep its `READY` status with stale vectors.
 */
const STAGE_JOBS: Record<ReprocessStage, JobType[]> = {
  frames: ['FRAME_EXTRACT', 'VISION_ANALYZE', 'MOMENT_EXTRACT', 'EMBED'],
  transcript: ['TRANSCRIPT', 'VISION_ANALYZE', 'MOMENT_EXTRACT', 'EMBED'],
  vision: ['VISION_ANALYZE', 'MOMENT_EXTRACT', 'EMBED'],
  moments: ['MOMENT_EXTRACT', 'EMBED'],
  embeddings: ['EMBED'],
};

/** A command refused because one of the asset's jobs is still RUNNING (F09). */
export class AssetBusyError extends Error {
  readonly code = 'ASSET_BUSY';
  constructor(assetId: string) {
    super(`asset ${assetId} has a job running; wait for it to finish before changing it`);
    this.name = 'AssetBusyError';
  }
}

/** Codes a command refuses with because the asset is not in a state for it. */
export type AssetStateCode = 'NOT_FOUND' | 'NO_ANALYSIS';

/**
 * A command's precondition on the asset's own state. Typed rather than a bare
 * `Error` so the HTTP edge answers with a status instead of a 500.
 */
export class AssetStateError extends Error {
  constructor(
    readonly code: AssetStateCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssetStateError';
  }
}

/**
 * `asset reprocess --from <stage>` (spec section 42): starts a new generation
 * for the asset (F09/F11) and enqueues the stage's first job for it, under the
 * per-asset lock. PENDING jobs of the superseded stages become CANCELLED,
 * COMPLETED ones stay as history, and a RUNNING one makes the command refuse
 * (`AssetBusyError`). Because the generation id is part of the idempotency key,
 * a fresh job is created even when the previous generation already COMPLETED the
 * same step. Frames and transcript are siblings in the fan-out (spec section 12):
 * reprocessing one does not disturb the other, and the barrier still enqueues
 * VISION_ANALYZE once the re-run step completes and the sibling's latest run is
 * COMPLETED.
 */
export async function reprocessAsset(
  db: Executor,
  assetId: string,
  from: ReprocessStage,
): Promise<{ generationId: string }> {
  const stageJobs = STAGE_JOBS[from];
  // Only the stages whose input names a file need the asset row itself.
  const asset = from === 'frames' || from === 'transcript' ? await getAsset(db, assetId) : null;
  if ((from === 'frames' || from === 'transcript') && !asset) {
    throw new AssetStateError('NOT_FOUND', `asset not found: ${assetId}`);
  }
  if (from === 'frames' && !asset?.analysisPath) {
    throw new AssetStateError('NO_ANALYSIS', `asset ${assetId} has no analysisPath yet`);
  }

  return db.transaction(async (tx) => {
    const { generationId, enqueue } = await startReprocess(tx, {
      kind: 'asset',
      entityId: assetId,
      supersededTypes: stageJobs,
      busyError: (entityId) => new AssetBusyError(entityId),
    });

    switch (from) {
      case 'vision':
        await enqueue('VISION_ANALYZE', { assetId });
        break;
      case 'moments':
        await enqueue('MOMENT_EXTRACT', { assetId });
        break;
      case 'embeddings':
        await enqueue('EMBED', { assetId });
        break;
      case 'frames':
        await enqueue('FRAME_EXTRACT', { assetId, analysisPath: asset?.analysisPath });
        break;
      case 'transcript':
        await enqueue('TRANSCRIPT', { assetId, originalPath: asset?.originalPath });
        break;
    }
    return { generationId };
  });
}
