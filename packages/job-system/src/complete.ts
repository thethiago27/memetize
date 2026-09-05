import { type Database, type JobRow, jobs } from '@memetize/database';
import { and, eq, lt, sql } from 'drizzle-orm';

/**
 * Marks a job COMPLETED. When a lease token is given the write is conditioned on
 * still holding a live lease (F08): zero rows means the lease was lost — another
 * worker reclaimed the job — and the caller must not treat the job as done or
 * publish its result. Returns null on lost ownership or a missing job.
 */
export async function completeJob(
  db: Database,
  id: string,
  result: Record<string, unknown>,
  leaseToken?: string,
): Promise<JobRow | null> {
  const guard = leaseToken
    ? [
        eq(jobs.status, 'RUNNING'),
        eq(jobs.leaseToken, leaseToken),
        sql`${jobs.leaseExpiresAt} > clock_timestamp()`,
      ]
    : [];
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
    .where(and(eq(jobs.id, id), ...guard))
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
  db: Database,
  id: string,
  args: FailArgs,
  leaseToken?: string,
): Promise<JobRow | null> {
  const current = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  if (!current) return null;

  const shouldRetry = (args.retryable ?? false) && current.attempts < current.maxAttempts;

  const guard = leaseToken
    ? [
        eq(jobs.status, 'RUNNING'),
        eq(jobs.leaseToken, leaseToken),
        sql`${jobs.leaseExpiresAt} > clock_timestamp()`,
      ]
    : [];
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
    .where(and(eq(jobs.id, id), ...guard))
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
 * Finalizes RUNNING jobs whose lease expired and whose attempts are exhausted
 * (F08): their worker crashed and cannot recover, so they become terminal
 * FAILED with `LEASE_EXPIRED`. Run at startup and periodically. Returns the
 * finalized jobs so the caller can propagate entity status under the same
 * coordination (only when the generation is still current — F09).
 */
export async function reconcileExpiredLeases(db: Database): Promise<ReconciledJob[]> {
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
    .where(
      and(
        eq(jobs.status, 'RUNNING'),
        sql`${jobs.attempts} >= ${jobs.maxAttempts}`,
        lt(jobs.leaseExpiresAt, sql`clock_timestamp()`),
      ),
    )
    .returning({
      id: jobs.id,
      entityId: jobs.entityId,
      type: jobs.type,
      generationId: jobs.generationId,
    });
  return rows;
}
