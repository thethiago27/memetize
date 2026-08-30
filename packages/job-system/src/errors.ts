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
