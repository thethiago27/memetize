import type { JobType, ResourceClass } from './enums';

/**
 * Which resource-scheduler bucket each job type consumes (spec section 8).
 * The M4 runs a single heavy GPU/render workload at a time.
 */
export const JOB_RESOURCE_CLASS: Record<JobType, ResourceClass> = {
  PING: 'CPU_LIGHT',
  VIDEO_NORMALIZE: 'CPU_HEAVY',
  SCENE_DETECT: 'CPU_LIGHT',
  FRAME_EXTRACT: 'IO',
  TRANSCRIPT: 'GPU',
  VISION_ANALYZE: 'GPU',
  MOMENT_EXTRACT: 'CPU_LIGHT',
  EMBED: 'GPU',
  AUDIO_ANALYZE: 'CPU_HEAVY',
  LYRICS: 'GPU',
  NARRATIVE: 'CPU_LIGHT',
  MATCH: 'CPU_LIGHT',
  DIRECTOR: 'CPU_LIGHT',
  TIMING: 'CPU_LIGHT',
  EFFECTS: 'CPU_LIGHT',
  RENDER: 'RENDER',
  FEEDBACK_EMBED: 'GPU',
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
  FRAME_EXTRACT: '1.0.0',
  TRANSCRIPT: '1.0.0',
  VISION_ANALYZE: '1.0.0',
  MOMENT_EXTRACT: '1.0.0',
  EMBED: '1.0.0',
  AUDIO_ANALYZE: '1.0.0',
  LYRICS: '1.0.0',
  NARRATIVE: '1.0.0',
  MATCH: '2.0.0',
  DIRECTOR: '1.1.0',
  TIMING: '1.0.0',
  EFFECTS: '1.1.0',
  RENDER: '1.0.0',
  FEEDBACK_EMBED: '1.0.0',
};
