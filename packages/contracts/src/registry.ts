import type { JobType, ResourceClass } from './enums';

/**
 * Which resource-scheduler bucket each job type consumes (spec section 8).
 * The M4 runs a single heavy GPU/render workload at a time.
 */
export const JOB_RESOURCE_CLASS: Record<JobType, ResourceClass> = {
  PING: 'CPU_LIGHT',
  VIDEO_NORMALIZE: 'CPU_HEAVY',
  SCENE_DETECT: 'CPU_LIGHT',
};

/**
 * Canonical worker version per job type. Part of the idempotency key
 * (type + entityId + inputHash + workerVersion, spec section 4.2). Bump when a
 * worker's behaviour changes so results are recomputed rather than reused.
 */
export const WORKER_VERSION: Record<JobType, string> = {
  PING: '1.0.0',
  VIDEO_NORMALIZE: '1.0.0',
  SCENE_DETECT: '1.0.0',
};
