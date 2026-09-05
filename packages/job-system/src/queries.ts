import type { JobType } from '@memetize/contracts';
import { type Database, type JobRow, jobs } from '@memetize/database';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import type { Executor } from './entity';

export function getJob(db: Database, id: string): Promise<JobRow | undefined> {
  return db.query.jobs.findFirst({ where: eq(jobs.id, id) });
}

export function listJobsForEntity(db: Executor, entityId: string): Promise<JobRow[]> {
  return db.query.jobs.findMany({
    where: eq(jobs.entityId, entityId),
    orderBy: asc(jobs.createdAt),
  });
}

/** Count of not-yet-terminal jobs for an entity; used to drive `--wait` drains. */
export async function countActiveForEntity(db: Database, entityId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(jobs)
    .where(and(eq(jobs.entityId, entityId), inArray(jobs.status, ['PENDING', 'RUNNING'])));
  return Number(rows[0]?.value ?? 0);
}

/** Count of RUNNING jobs for an entity among the given types (F09 busy check). */
export async function countRunningForEntity(
  db: Executor,
  entityId: string,
  types: JobType[],
): Promise<number> {
  if (types.length === 0) return 0;
  const rows = await db
    .select({ value: count() })
    .from(jobs)
    .where(and(eq(jobs.entityId, entityId), eq(jobs.status, 'RUNNING'), inArray(jobs.type, types)));
  return Number(rows[0]?.value ?? 0);
}

/**
 * Deletes an entity's job rows for the given types, so a later `enqueueJob`
 * with the same idempotency key creates a fresh job instead of returning the
 * old (already COMPLETED) one. Used by `asset reprocess --from` (spec section
 * 42).
 *
 * A RUNNING job is never deleted (F09): its handler may still be writing
 * timelines, files and jobs, and pulling the row out from under it corrupts
 * state. Callers must cancel active jobs first (see `cancelActiveJobsForEntity`)
 * so only terminal rows remain to delete.
 */
export async function deleteJobsForEntity(
  db: Executor,
  entityId: string,
  types: JobType[],
): Promise<void> {
  if (types.length === 0) return;
  await db
    .delete(jobs)
    .where(and(eq(jobs.entityId, entityId), inArray(jobs.type, types), ne(jobs.status, 'RUNNING')));
}

/**
 * Marks an entity's not-yet-terminal jobs (PENDING or RUNNING) of the given
 * types as CANCELLED without deleting history (F09). A RUNNING job's lease is
 * left intact so its own lease-guarded completion/heartbeat will find the row no
 * longer RUNNING and stop; its subprocess should be signalled separately.
 */
export async function cancelActiveJobsForEntity(
  db: Executor,
  entityId: string,
  types: JobType[],
): Promise<JobRow[]> {
  if (types.length === 0) return [];
  return db
    .update(jobs)
    .set({ status: 'CANCELLED', completedAt: new Date() })
    .where(
      and(
        eq(jobs.entityId, entityId),
        inArray(jobs.type, types),
        inArray(jobs.status, ['PENDING', 'RUNNING']),
      ),
    )
    .returning();
}
