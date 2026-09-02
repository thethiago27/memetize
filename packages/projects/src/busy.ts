import { type Database, jobs } from '@memetize/database';
import { and, eq } from 'drizzle-orm';

export class ProjectBusyError extends Error {
  readonly code = 'PROJECT_BUSY';
  constructor(projectId: string) {
    super(`project ${projectId} has a job running; wait for it to finish before changing it`);
    this.name = 'ProjectBusyError';
  }
}

/**
 * Throws `ProjectBusyError` while a job for the project is RUNNING: an
 * in-flight worker would otherwise write against rows being replaced.
 * PENDING jobs are fine; callers drop or re-enqueue them.
 */
export async function assertProjectIdle(db: Database, projectId: string): Promise<void> {
  const running = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.entityId, projectId), eq(jobs.status, 'RUNNING')))
    .limit(1);
  if (running.length > 0) throw new ProjectBusyError(projectId);
}
