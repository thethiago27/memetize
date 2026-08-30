import type { JobType } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import { deleteJobsForEntity, enqueueJob } from '@memetize/job-system';
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
 * Jobs to drop for each stage: the stage's own job plus everything
 * downstream. Every earlier stage also drops `EMBED` now (spec section 40):
 * otherwise the asset would keep its `READY` status with stale vectors.
 */
const STAGE_JOBS: Record<ReprocessStage, JobType[]> = {
  frames: ['FRAME_EXTRACT', 'VISION_ANALYZE', 'MOMENT_EXTRACT', 'EMBED'],
  transcript: ['TRANSCRIPT', 'VISION_ANALYZE', 'MOMENT_EXTRACT', 'EMBED'],
  vision: ['VISION_ANALYZE', 'MOMENT_EXTRACT', 'EMBED'],
  moments: ['MOMENT_EXTRACT', 'EMBED'],
  embeddings: ['EMBED'],
};

/**
 * `asset reprocess --from <stage>` (spec section 42): deletes the stage's job
 * (and everything downstream) then re-enqueues it. Deleting first is
 * required because `enqueueJob` is idempotent — re-enqueuing a still-present
 * COMPLETED job would just return it instead of doing new work. Frames and
 * transcript are siblings in the fan-out (spec section 12): reprocessing one
 * does not disturb the other, and the frames/transcript barrier still
 * re-enqueues VISION_ANALYZE once both are COMPLETED again.
 */
export async function reprocessAsset(
  db: Database,
  assetId: string,
  from: ReprocessStage,
): Promise<void> {
  await deleteJobsForEntity(db, assetId, STAGE_JOBS[from]);

  if (from === 'vision') {
    await enqueueJob(db, { type: 'VISION_ANALYZE', entityId: assetId, input: { assetId } });
    return;
  }
  if (from === 'moments') {
    await enqueueJob(db, { type: 'MOMENT_EXTRACT', entityId: assetId, input: { assetId } });
    return;
  }
  if (from === 'embeddings') {
    await enqueueJob(db, { type: 'EMBED', entityId: assetId, input: { assetId } });
    return;
  }

  const asset = await getAsset(db, assetId);
  if (!asset) throw new Error(`asset not found: ${assetId}`);

  if (from === 'frames') {
    if (!asset.analysisPath) throw new Error(`asset ${assetId} has no analysisPath yet`);
    await enqueueJob(db, {
      type: 'FRAME_EXTRACT',
      entityId: assetId,
      input: { assetId, analysisPath: asset.analysisPath },
    });
    return;
  }

  // from === 'transcript'
  await enqueueJob(db, {
    type: 'TRANSCRIPT',
    entityId: assetId,
    input: { assetId, originalPath: asset.originalPath },
  });
}
