import { type Database, type JobRow, jobs } from '@memetize/database';
import { eq } from 'drizzle-orm';

export async function completeJob(
  db: Database,
  id: string,
  result: Record<string, unknown>,
): Promise<JobRow | null> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'COMPLETED',
      result,
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(jobs.id, id))
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
 * PENDING for another claim; otherwise the job becomes terminal FAILED.
 */
export async function failJob(db: Database, id: string, args: FailArgs): Promise<JobRow | null> {
  const current = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  if (!current) return null;

  const shouldRetry = (args.retryable ?? false) && current.attempts < current.maxAttempts;

  const rows = await db
    .update(jobs)
    .set({
      status: shouldRetry ? 'PENDING' : 'FAILED',
      errorCode: args.code,
      errorMessage: args.message,
      startedAt: shouldRetry ? null : current.startedAt,
      completedAt: shouldRetry ? null : new Date(),
    })
    .where(eq(jobs.id, id))
    .returning();
  return rows[0] ?? null;
}
