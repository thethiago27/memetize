import type { JobType } from '@memetize/contracts';
import { type Database, type JobRow, jobs } from '@memetize/database';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

export interface ClaimArgs {
  entityId?: string;
  types?: JobType[];
}

/**
 * Atomically claims the next PENDING job and moves it to RUNNING using
 * `FOR UPDATE SKIP LOCKED` (spec section 7), so concurrent workers never grab
 * the same job. Returns null when nothing is claimable.
 */
export async function claimNextJob(db: Database, args: ClaimArgs = {}): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    const conditions = [eq(jobs.status, 'PENDING')];
    if (args.entityId) conditions.push(eq(jobs.entityId, args.entityId));
    if (args.types && args.types.length > 0) conditions.push(inArray(jobs.type, args.types));

    const candidates = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.priority), asc(jobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });

    const candidate = candidates[0];
    if (!candidate) return null;

    const updated = await tx
      .update(jobs)
      .set({
        status: 'RUNNING',
        startedAt: new Date(),
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(eq(jobs.id, candidate.id))
      .returning();

    return updated[0] ?? null;
  });
}
