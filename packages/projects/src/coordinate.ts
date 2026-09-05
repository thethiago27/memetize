import { ensureEntityExecution, type Executor, lockEntity } from '@memetize/job-system';

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
