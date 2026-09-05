import type { Executor } from '@memetize/database';
import { listJobsForEntity } from '@memetize/job-system';
import { reprocessProject } from './reprocess';

/**
 * `project generate <projectId>` (spec section 42): forces a fresh
 * `DIRECTOR` run — and therefore a new `timeline_versions` row — even when
 * the previous run already COMPLETED with the same `inputHash` (a plain
 * `enqueueJob` would just return that existing job). Requires a completed
 * `MATCH` first: without a shortlist there is nothing for the Director to
 * choose from.
 */
export async function generateTimeline(db: Executor, projectId: string): Promise<void> {
  const jobs = await listJobsForEntity(db, projectId);
  const match = jobs.find((job) => job.type === 'MATCH');
  if (match?.status !== 'COMPLETED') {
    throw new Error(
      `project ${projectId} has no completed MATCH yet — run 'project create' or 'project reprocess --from match' first`,
    );
  }
  await reprocessProject(db, projectId, 'director');
}
