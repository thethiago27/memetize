import {
  JOB_RESOURCE_CLASS,
  type JobType,
  type ResourceClass,
  WORKER_VERSION,
} from '@memetize/contracts';
import { type JobRow, jobs } from '@memetize/database';
import { hashInput, jobId } from '@memetize/shared';
import { and, eq } from 'drizzle-orm';
import type { Executor } from './entity';

export interface EnqueueArgs {
  type: JobType;
  entityId: string;
  input?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  workerVersion?: string;
  resourceClass?: ResourceClass;
}

export interface EnqueueResult {
  job: JobRow;
  /** false when an identical job already existed (idempotent no-op). */
  created: boolean;
}

/**
 * Enqueues a job, idempotent on (type, entityId, inputHash, workerVersion).
 * A second enqueue with the same logical key returns the existing job instead
 * of creating a duplicate (spec section 4.2).
 */
export async function enqueueJob(db: Executor, args: EnqueueArgs): Promise<EnqueueResult> {
  const input = args.input ?? {};
  const workerVersion = args.workerVersion ?? WORKER_VERSION[args.type];
  const resourceClass = args.resourceClass ?? JOB_RESOURCE_CLASS[args.type];
  const inputHash = hashInput(input);

  const inserted = await db
    .insert(jobs)
    .values({
      id: jobId(),
      type: args.type,
      entityId: args.entityId,
      status: 'PENDING',
      payload: input,
      priority: args.priority ?? 0,
      resourceClass,
      maxAttempts: args.maxAttempts ?? 3,
      inputHash,
      workerVersion,
    })
    .onConflictDoNothing({
      target: [jobs.type, jobs.entityId, jobs.inputHash, jobs.workerVersion],
    })
    .returning();

  const created = inserted[0];
  if (created) return { job: created, created: true };

  const existing = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.type, args.type),
      eq(jobs.entityId, args.entityId),
      eq(jobs.inputHash, inputHash),
      eq(jobs.workerVersion, workerVersion),
    ),
  });
  if (!existing) {
    throw new Error('enqueue hit a conflict but the existing job could not be found');
  }
  return { job: existing, created: false };
}
