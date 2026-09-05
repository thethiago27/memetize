import { type Executor, type JobRow, jobs } from '@memetize/database';
import { and, eq, sql } from 'drizzle-orm';
import { leaseGone, ownedBy } from './claim';

/**
 * Marks a job COMPLETED. When a lease token is given the write is conditioned on
 * still holding a live lease (F08): zero rows means the lease was lost — another
 * worker reclaimed the job — and the caller must not treat the job as done or
 * publish its result. Returns null on lost ownership or a missing job. Accepts a
 * transaction handle so completion commits together with the domain writes and
 * follow-up jobs it belongs to (F10).
 */
export async function completeJob(
  db: Executor,
  id: string,
  result: Record<string, unknown>,
  leaseToken?: string,
): Promise<JobRow | null> {
  const where = leaseToken ? ownedBy(id, leaseToken) : eq(jobs.id, id);
  const rows = await db
    .update(jobs)
    .set({
      status: 'COMPLETED',
      result,
      completedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
      errorCode: null,
      errorMessage: null,
    })
    .where(where)
    .returning();
  return rows[0] ?? null;
}

export interface FailArgs {
  code: string;
  message: string;
  retryable?: boolean;
}

/**
 * Records a failure. Retryable failures with attempts left return the job to
 * PENDING for another claim; otherwise the job becomes terminal FAILED. Both
 * clear the lease. When a token is given the write is lease-guarded like
 * `completeJob`, so a stale attempt cannot overwrite a job it no longer owns.
 */
export async function failJob(
  db: Executor,
  id: string,
  args: FailArgs,
  leaseToken?: string,
): Promise<JobRow | null> {
  const current = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  if (!current) return null;

  const shouldRetry = (args.retryable ?? false) && current.attempts < current.maxAttempts;

  const where = leaseToken ? ownedBy(id, leaseToken) : eq(jobs.id, id);
  const rows = await db
    .update(jobs)
    .set({
      status: shouldRetry ? 'PENDING' : 'FAILED',
      errorCode: args.code,
      errorMessage: args.message,
      startedAt: shouldRetry ? null : current.startedAt,
      completedAt: shouldRetry ? null : new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(where)
    .returning();
  return rows[0] ?? null;
}

/**
 * Ends an owned attempt whose generation was superseded while it ran (F09): the
 * job becomes CANCELLED (history kept, no retry) instead of publishing over the
 * newer generation. Lease-guarded like `completeJob`.
 */
export async function cancelOwnedJob(
  db: Executor,
  id: string,
  leaseToken: string,
  reason: string,
): Promise<JobRow | null> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'CANCELLED',
      errorCode: 'GENERATION_SUPERSEDED',
      errorMessage: reason,
      completedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(ownedBy(id, leaseToken))
    .returning();
  return rows[0] ?? null;
}

export interface ReconciledJob {
  id: string;
  entityId: string;
  type: string;
  generationId: string | null;
}

/**
 * Finalizes RUNNING jobs whose lease expired (or was never set) and whose
 * attempts are exhausted (F08): their worker crashed and cannot recover, so they
 * become terminal FAILED with `LEASE_EXPIRED`. Jobs with attempts left are not
 * touched here — the claim path picks them up. Run at startup and periodically.
 * Returns the finalized jobs so the caller can propagate entity status (only when
 * the generation is still current — F09).
 */
export async function reconcileExpiredLeases(db: Executor): Promise<ReconciledJob[]> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'FAILED',
      errorCode: 'LEASE_EXPIRED',
      errorMessage: 'worker lease expired and attempts were exhausted',
      completedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(jobs.status, 'RUNNING'), sql`${jobs.attempts} >= ${jobs.maxAttempts}`, leaseGone))
    .returning({
      id: jobs.id,
      entityId: jobs.entityId,
      type: jobs.type,
      generationId: jobs.generationId,
    });
  return rows;
}
