import {
  JOB_RESOURCE_CLASS,
  type JobType,
  type ResourceClass,
  WORKER_VERSION,
} from '@memetize/contracts';
import { type Executor, type JobRow, jobs } from '@memetize/database';
import { hashInput, jobId } from '@memetize/shared';
import { and, eq } from 'drizzle-orm';

export interface EnqueueArgs {
  type: JobType;
  entityId: string;
  input?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  workerVersion?: string;
  resourceClass?: ResourceClass;
  /**
   * Generation this job runs for (F09/F11). Stored on the row and folded into
   * the payload, so the idempotency hash differs between generations and a
   * re-run never returns the previous generation's COMPLETED job. Null/omitted
   * only for jobs outside an entity pipeline (PING, FEEDBACK_EMBED).
   */
  generationId?: string | null;
  /**
   * Logical step within the generation (F10), e.g. `narrative`. One row per
   * (entity, generation, step): a fan-in continuation enqueued twice by two
   * racing siblings collapses onto the same job.
   */
  stepKey?: string | null;
}

export interface EnqueueResult {
  job: JobRow;
  /** false when an identical job already existed (idempotent no-op). */
  created: boolean;
}

/** Default step key for a job type: its lowercase name (one occurrence per generation). */
export function stepKeyFor(type: JobType): string {
  return type.toLowerCase();
}

/**
 * Enqueues a job, idempotent on (type, entityId, inputHash, workerVersion) and,
 * when a generation is given, on (entityId, generationId, stepKey) as well. A
 * second enqueue with the same logical key returns the existing job instead of
 * creating a duplicate (spec section 4.2). Accepts a transaction handle so the
 * enqueue commits together with the state it follows from (F10).
 */
export async function enqueueJob(db: Executor, args: EnqueueArgs): Promise<EnqueueResult> {
  const generationId = args.generationId ?? null;
  const input = generationId ? { ...(args.input ?? {}), generationId } : (args.input ?? {});
  const stepKey = generationId ? (args.stepKey ?? stepKeyFor(args.type)) : (args.stepKey ?? null);
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
      generationId,
      stepKey,
    })
    // No target: either unique key (idempotency or generation step) may collide.
    .onConflictDoNothing()
    .returning();

  const created = inserted[0];
  if (created) return { job: created, created: true };

  const existing =
    (await db.query.jobs.findFirst({
      where: and(
        eq(jobs.type, args.type),
        eq(jobs.entityId, args.entityId),
        eq(jobs.inputHash, inputHash),
        eq(jobs.workerVersion, workerVersion),
      ),
    })) ??
    (generationId && stepKey
      ? await db.query.jobs.findFirst({
          where: and(
            eq(jobs.entityId, args.entityId),
            eq(jobs.generationId, generationId),
            eq(jobs.stepKey, stepKey),
          ),
        })
      : undefined);
  if (!existing) {
    throw new Error('enqueue hit a conflict but the existing job could not be found');
  }
  return { job: existing, created: false };
}
