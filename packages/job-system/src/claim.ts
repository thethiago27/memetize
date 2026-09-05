import { randomUUID } from 'node:crypto';
import type { JobType } from '@memetize/contracts';
import { type Database, type JobRow, jobs } from '@memetize/database';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

/** Default lease duration; a worker must renew before this elapses (F08). */
export const DEFAULT_LEASE_MS = 60_000;

export interface ClaimArgs {
  entityId?: string;
  types?: JobType[];
  /** Lease duration in ms; the claimed job is reclaimable after it expires. */
  leaseMs?: number;
}

export interface ClaimedJob {
  job: JobRow;
  /** The lease token this claim holds; required to renew, complete, or fail. */
  leaseToken: string;
}

/**
 * Atomically claims the next runnable job and moves it to RUNNING using
 * `FOR UPDATE SKIP LOCKED` (spec section 7), so concurrent workers never grab
 * the same job. A job is claimable when it is PENDING, or RUNNING with an
 * expired lease (its previous worker crashed) — in both cases only while
 * attempts remain. The claim stamps a fresh random lease token and expiry;
 * completion, failure and heartbeat are all conditioned on still holding it, so
 * a stale attempt that lost the job can never publish (F08). Returns null when
 * nothing is claimable.
 */
export async function claimNextJob(db: Database, args: ClaimArgs = {}): Promise<ClaimedJob | null> {
  const leaseMs = args.leaseMs ?? DEFAULT_LEASE_MS;
  const leaseToken = randomUUID();

  return db.transaction(async (tx) => {
    const scope = [sql`${jobs.attempts} < ${jobs.maxAttempts}`];
    if (args.entityId) scope.push(eq(jobs.entityId, args.entityId));
    if (args.types && args.types.length > 0) scope.push(inArray(jobs.type, args.types));

    const runnable = or(
      eq(jobs.status, 'PENDING'),
      and(eq(jobs.status, 'RUNNING'), lt(jobs.leaseExpiresAt, sql`clock_timestamp()`)),
    );

    const candidates = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(...scope, runnable))
      .orderBy(desc(jobs.priority), asc(jobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });

    const candidate = candidates[0];
    if (!candidate) return null;

    const updated = await tx
      .update(jobs)
      .set({
        status: 'RUNNING',
        startedAt: sql`clock_timestamp()`,
        completedAt: null,
        attempts: sql`${jobs.attempts} + 1`,
        leaseToken,
        leaseExpiresAt: sql`clock_timestamp() + ${`${leaseMs} milliseconds`}::interval`,
      })
      .where(eq(jobs.id, candidate.id))
      .returning();

    const job = updated[0];
    return job ? { job, leaseToken } : null;
  });
}

/**
 * Renews a running job's lease (heartbeat). Only the current lease holder can
 * renew; zero rows means ownership was lost and the attempt must stop.
 */
export async function renewLease(
  db: Database,
  jobId: string,
  leaseToken: string,
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ leaseExpiresAt: sql`clock_timestamp() + ${`${leaseMs} milliseconds`}::interval` })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, 'RUNNING'),
        eq(jobs.leaseToken, leaseToken),
        sql`${jobs.leaseExpiresAt} > clock_timestamp()`,
      ),
    )
    .returning({ id: jobs.id });
  return rows.length > 0;
}
