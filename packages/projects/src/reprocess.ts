import type { JobType } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import { deleteJobsForEntity, enqueueJob } from '@memetize/job-system';
import { getProjectAudio } from './projects';

export const REPROCESS_STAGES = ['audio', 'lyrics', 'narrative', 'match', 'director'] as const;
export type ReprocessStage = (typeof REPROCESS_STAGES)[number];

/**
 * Jobs to drop for each stage: the stage's own job plus everything
 * downstream. `audio` and `lyrics` also drop `NARRATIVE`, `MATCH` and
 * `DIRECTOR` (mirrors `reprocessAsset` in `@memetize/media-catalog`):
 * otherwise `project inspect` would show narrative segments, shortlists, or
 * a timeline derived from stale audio/lyrics. `director` never drops
 * `segment_matches` / `narrative_segments` — only the job, so the chain
 * re-enqueues it against the *same* upstream data.
 */
const STAGE_JOBS: Record<ReprocessStage, JobType[]> = {
  audio: ['AUDIO_ANALYZE', 'NARRATIVE', 'MATCH', 'DIRECTOR'],
  lyrics: ['LYRICS', 'NARRATIVE', 'MATCH', 'DIRECTOR'],
  narrative: ['NARRATIVE', 'MATCH', 'DIRECTOR'],
  match: ['MATCH', 'DIRECTOR'],
  director: ['DIRECTOR'],
};

/**
 * `project reprocess --from <stage>` (spec section 42): deletes the stage's
 * job (and everything downstream) then re-enqueues it. `audio` and `lyrics`
 * are siblings in the fan-out (spec section 24) — reprocessing one leaves the
 * other's (already COMPLETED) job alone, and the barrier still re-enqueues
 * NARRATIVE once both are COMPLETED again. Dropping `DIRECTOR` this way is
 * also how `project generate` forces a fresh `timeline_versions` row even
 * when the previous run is still COMPLETED with the same `inputHash`
 * (spec section 35: a plain `enqueueJob` would be a no-op).
 */
export async function reprocessProject(
  db: Database,
  projectId: string,
  from: ReprocessStage,
): Promise<void> {
  await deleteJobsForEntity(db, projectId, STAGE_JOBS[from]);

  if (from === 'director') {
    await enqueueJob(db, { type: 'DIRECTOR', entityId: projectId, input: { projectId } });
    return;
  }

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
    input: {
      projectId,
      lyricsPath: audio.lyricsPath,
      originalPath: audio.originalPath,
      durationMs: audio.durationMs,
    },
  });
}
