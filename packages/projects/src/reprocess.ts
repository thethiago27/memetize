import type { JobType } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import { deleteJobsForEntity, enqueueJob } from '@memetize/job-system';
import { getProjectAudio } from './projects';

export const REPROCESS_STAGES = [
  'audio',
  'lyrics',
  'narrative',
  'match',
  'director',
  'timing',
  'render',
] as const;
export type ReprocessStage = (typeof REPROCESS_STAGES)[number];

/**
 * Jobs to drop for each stage: the stage's own job plus everything
 * downstream. `audio` and `lyrics` also drop `NARRATIVE`, `MATCH`,
 * `DIRECTOR`, `TIMING` and `RENDER` (mirrors `reprocessAsset` in
 * `@memetize/media-catalog`): otherwise `project inspect` would show
 * narrative segments, shortlists, a timeline, or an MP4 derived from stale
 * upstream data. `director` never drops `segment_matches` /
 * `narrative_segments`, and `render` never drops `timeline_versions` —
 * only the job(s), so the chain re-enqueues against the *same* upstream data.
 * `timing` never drops the Director's raw version either — re-running it
 * just re-aligns the same picks against the same beats/downbeats.
 */
const STAGE_JOBS: Record<ReprocessStage, JobType[]> = {
  audio: ['AUDIO_ANALYZE', 'NARRATIVE', 'MATCH', 'DIRECTOR', 'TIMING', 'RENDER'],
  lyrics: ['LYRICS', 'NARRATIVE', 'MATCH', 'DIRECTOR', 'TIMING', 'RENDER'],
  narrative: ['NARRATIVE', 'MATCH', 'DIRECTOR', 'TIMING', 'RENDER'],
  match: ['MATCH', 'DIRECTOR', 'TIMING', 'RENDER'],
  director: ['DIRECTOR', 'TIMING', 'RENDER'],
  timing: ['TIMING', 'RENDER'],
  render: ['RENDER'],
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

  if (from === 'render') {
    await enqueueJob(db, { type: 'RENDER', entityId: projectId, input: { projectId } });
    return;
  }

  if (from === 'director') {
    await enqueueJob(db, { type: 'DIRECTOR', entityId: projectId, input: { projectId } });
    return;
  }

  if (from === 'timing') {
    await enqueueJob(db, { type: 'TIMING', entityId: projectId, input: { projectId } });
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
