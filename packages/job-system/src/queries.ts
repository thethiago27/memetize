import type { JobStatus, JobType } from '@memetize/contracts';
import { type Database, type Executor, type JobRow, jobs } from '@memetize/database';
import { and, asc, count, eq, inArray } from 'drizzle-orm';

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
 * Marks an entity's not-yet-terminal jobs of the given types as CANCELLED without
 * deleting history (F09). Defaults to PENDING and RUNNING; a reprocess that has
 * already refused to run while a job is RUNNING passes `['PENDING']`. A RUNNING
 * job's lease is left intact so its own lease-guarded completion/heartbeat will
 * find the row no longer RUNNING and stop; its subprocess should be signalled
 * separately.
 */
export async function cancelActiveJobsForEntity(
  db: Executor,
  entityId: string,
  types: JobType[],
  statuses: JobStatus[] = ['PENDING', 'RUNNING'],
): Promise<JobRow[]> {
  if (types.length === 0 || statuses.length === 0) return [];
  return db
    .update(jobs)
    .set({
      status: 'CANCELLED',
      errorCode: 'SUPERSEDED',
      errorMessage: 'cancelled by a newer generation of the pipeline',
      completedAt: new Date(),
    })
    .where(
      and(eq(jobs.entityId, entityId), inArray(jobs.type, types), inArray(jobs.status, statuses)),
    )
    .returning();
}
