import { type Database, type JobRow, jobs } from '@memetize/database';
import { and, asc, count, eq, inArray } from 'drizzle-orm';

export function getJob(db: Database, id: string): Promise<JobRow | undefined> {
  return db.query.jobs.findFirst({ where: eq(jobs.id, id) });
}

export function listJobsForEntity(db: Database, entityId: string): Promise<JobRow[]> {
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
