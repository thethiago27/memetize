import {
  type Executor,
  ensureEntityExecution,
  getActiveGeneration,
  lockEntity,
  startGeneration,
} from '@memetize/job-system';

/**
 * Acquires the per-project coordination lock for the current transaction (F09).
 * Ensures the coordination row exists first (self-healing for projects created
 * before F09), then locks it `FOR UPDATE`, so concurrent version inserts and
 * commands on the same project serialize instead of racing a `max()+1` read.
 */
export async function lockProject(tx: Executor, projectId: string): Promise<void> {
  await ensureEntityExecution(tx, 'project', projectId);
  await lockEntity(tx, 'project', projectId);
}

/**
 * Starts a new pipeline generation for the project and makes it the active one
 * (F09/F11). Call under `lockProject`. Every job the command enqueues carries the
 * returned id; a job from a previous generation that is still running will find
 * its generation superseded when it tries to publish.
 */
export function startProjectGeneration(tx: Executor, projectId: string): Promise<string> {
  return startGeneration(tx, 'project', projectId);
}

/** The project's active generation id, or null before any pipeline ran. */
export function getProjectGeneration(db: Executor, projectId: string): Promise<string | null> {
  return getActiveGeneration(db, 'project', projectId);
}
