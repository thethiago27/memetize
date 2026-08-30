import type { JobType } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import { deleteJobsForEntity, enqueueJob } from '@memetize/job-system';
import { getProjectAudio } from './projects';

export const REPROCESS_STAGES = ['audio', 'lyrics', 'narrative', 'match'] as const;
export type ReprocessStage = (typeof REPROCESS_STAGES)[number];

/**
 * Jobs to drop for each stage: the stage's own job plus everything
 * downstream. `audio` and `lyrics` also drop `NARRATIVE` and `MATCH`
 * (mirrors `reprocessAsset` in `@memetize/media-catalog`): otherwise
 * `project inspect` would show narrative segments or shortlists derived
 * from stale audio/lyrics.
 */
const STAGE_JOBS: Record<ReprocessStage, JobType[]> = {
  audio: ['AUDIO_ANALYZE', 'NARRATIVE', 'MATCH'],
  lyrics: ['LYRICS', 'NARRATIVE', 'MATCH'],
  narrative: ['NARRATIVE', 'MATCH'],
  match: ['MATCH'],
};

/**
 * `project reprocess --from <stage>` (spec section 42): deletes the stage's
 * job (and everything downstream) then re-enqueues it. `audio` and `lyrics`
 * are siblings in the fan-out (spec section 24) — reprocessing one leaves the
 * other's (already COMPLETED) job alone, and the barrier still re-enqueues
 * NARRATIVE once both are COMPLETED again.
 */
export async function reprocessProject(
  db: Database,
  projectId: string,
  from: ReprocessStage,
): Promise<void> {
  await deleteJobsForEntity(db, projectId, STAGE_JOBS[from]);

  if (from === 'match') {
    await enqueueJob(db, { type: 'MATCH', entityId: projectId, input: { projectId } });
    return;
  }

  if (from === 'narrative') {
    await enqueueJob(db, { type: 'NARRATIVE', entityId: projectId, input: { projectId } });
    return;
  }

  const audio = await getProjectAudio(db, projectId);
  if (!audio) throw new Error(`project ${projectId} has no audio yet`);

  if (from === 'audio') {
    await enqueueJob(db, {
      type: 'AUDIO_ANALYZE',
      entityId: projectId,
      input: { projectId, originalPath: audio.originalPath, durationMs: audio.durationMs },
    });
    return;
  }

  // from === 'lyrics'
  await enqueueJob(db, {
    type: 'LYRICS',
    entityId: projectId,
    input: { projectId, lyricsPath: audio.lyricsPath, durationMs: audio.durationMs },
  });
}
