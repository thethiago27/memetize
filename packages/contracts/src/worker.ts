import { z } from 'zod';

/**
 * Universal worker protocol (spec section 9). TypeScript and Python workers
 * exchange exactly these shapes. Python workers receive the request as JSON on
 * stdin and emit a single JSON result on stdout; logs go to stderr.
 */

export const WorkerRequest = z.object({
  jobId: z.string(),
  entityId: z.string(),
  workerVersion: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type WorkerRequest = z.infer<typeof WorkerRequest>;

export const WorkerMetadata = z.object({
  processingTimeMs: z.number().int().nonnegative(),
  workerVersion: z.string(),
});
export type WorkerMetadata = z.infer<typeof WorkerMetadata>;

export const WorkerSuccess = z.object({
  jobId: z.string(),
  status: z.literal('success'),
  output: z.record(z.string(), z.unknown()),
  metadata: WorkerMetadata,
});
export type WorkerSuccess = z.infer<typeof WorkerSuccess>;

export const WorkerError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
});
export type WorkerError = z.infer<typeof WorkerError>;

export const WorkerFailure = z.object({
  jobId: z.string(),
  status: z.literal('failed'),
  error: WorkerError,
});
export type WorkerFailure = z.infer<typeof WorkerFailure>;

export const WorkerResult = z.discriminatedUnion('status', [WorkerSuccess, WorkerFailure]);
export type WorkerResult = z.infer<typeof WorkerResult>;
