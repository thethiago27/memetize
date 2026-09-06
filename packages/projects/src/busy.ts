import { type Executor, jobs } from '@memetize/database';
import { and, eq } from 'drizzle-orm';

export class ProjectBusyError extends Error {
  readonly code = 'PROJECT_BUSY';
  constructor(projectId: string) {
    super(`project ${projectId} has a job running; wait for it to finish before changing it`);
    this.name = 'ProjectBusyError';
  }
}

/** Codes a command refuses with because the project is not in a state for it. */
export type ProjectStateCode = 'NO_MATCH' | 'NO_TIMELINE' | 'NO_AUDIO' | 'NO_ANALYSIS';

/**
 * A command's precondition on the project's own state — "generate needs a
 * completed MATCH", "render needs a timeline". Typed rather than a bare
 * `Error` so the HTTP edge can answer `409 <code>` instead of turning a
 * caller's mistake into a 500.
 */
export class ProjectStateError extends Error {
  constructor(
    readonly code: ProjectStateCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectStateError';
  }
}

/**
 * Throws `ProjectBusyError` while a job for the project is RUNNING: an
 * in-flight worker would otherwise write against rows being replaced.
 * PENDING jobs are fine; callers drop or re-enqueue them.
 */
export async function assertProjectIdle(db: Executor, projectId: string): Promise<void> {
  const running = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.entityId, projectId), eq(jobs.status, 'RUNNING')))
    .limit(1);
  if (running.length > 0) throw new ProjectBusyError(projectId);
}
