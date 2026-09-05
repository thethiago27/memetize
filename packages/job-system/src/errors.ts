/**
 * Thrown by a job handler to signal a structured failure. The orchestrator maps
 * it onto the job's error fields and decides retry vs. terminal (spec section 9).
 */
export class JobFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'JobFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * The attempt no longer holds the job's lease (F08): another worker reclaimed
 * it, or it expired. Nothing from this attempt may be published; the transaction
 * that detected it rolls back.
 */
export class LeaseLostError extends Error {
  readonly code = 'LEASE_LOST';

  constructor(jobId: string) {
    super(`job ${jobId}: lease lost; this attempt no longer owns the job`);
    this.name = 'LeaseLostError';
  }
}

/**
 * The job belongs to a generation that is no longer the entity's active one
 * (F09/F11): a reprocess/generate/render command replaced it while this attempt
 * was running. Its result must not be published over the newer generation.
 */
export class GenerationSupersededError extends Error {
  readonly code = 'GENERATION_SUPERSEDED';

  constructor(entityId: string, generationId: string, active: string | null) {
    super(
      `entity ${entityId}: generation ${generationId} was superseded by ${active ?? 'none'}; result discarded`,
    );
    this.name = 'GenerationSupersededError';
  }
}

/** A command refused because a job for the entity is still RUNNING (F09). */
export class EntityBusyError extends Error {
  readonly code = 'ENTITY_BUSY';

  constructor(entityId: string) {
    super(`entity ${entityId} has a job running; wait for it to finish before changing it`);
    this.name = 'EntityBusyError';
  }
}
