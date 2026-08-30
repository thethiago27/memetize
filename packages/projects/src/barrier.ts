import type { Database } from '@memetize/database';
import { type EnqueueResult, enqueueJob, listJobsForEntity } from '@memetize/job-system';

type BarrierJobType = 'AUDIO_ANALYZE' | 'LYRICS';

const OTHER_TYPE: Record<BarrierJobType, BarrierJobType> = {
  AUDIO_ANALYZE: 'LYRICS',
  LYRICS: 'AUDIO_ANALYZE',
};

/**
 * Fan-in after project ingest (spec section 24): audio analysis and lyrics
 * run independently, and the narrative analyzer only starts once both are
 * done. Each side calls this after finishing its own work, checking the
 * *other* type's job status rather than its own — the orchestrator only
 * marks a job COMPLETED after the handler returns, so reading "self" here
 * would always see a stale, non-terminal status.
 */
export async function maybeEnqueueNarrative(
  db: Database,
  projectId: string,
  completedType: BarrierJobType,
): Promise<EnqueueResult | null> {
  const jobsForProject = await listJobsForEntity(db, projectId);
  const other = jobsForProject.find((job) => job.type === OTHER_TYPE[completedType]);
  if (other?.status !== 'COMPLETED') return null;
  return enqueueJob(db, { type: 'NARRATIVE', entityId: projectId, input: { projectId } });
}
