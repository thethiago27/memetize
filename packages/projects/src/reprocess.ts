import type { JobType } from '@memetize/contracts';
import type { Executor } from '@memetize/database';
import {
  cancelActiveJobsForEntity,
  countRunningForEntity,
  enqueueJob,
  stepKeyFor,
} from '@memetize/job-system';
import { ProjectBusyError, ProjectStateError } from './busy';
import { lockProject, startProjectGeneration } from './coordinate';
import { getProjectAudio } from './projects';
import { getLatestTimeline } from './timeline';
import { getLatestEditWindow } from './window';

export const REPROCESS_STAGES = [
  'audio',
  'lyrics',
  'subtitles',
  'narrative',
  'match',
  'director',
  'timing',
  'effects',
  'render',
] as const;
export type ReprocessStage = (typeof REPROCESS_STAGES)[number];

/**
 * Jobs superseded by each stage: the stage's own job plus everything
 * downstream. `audio` and `lyrics` also supersede `NARRATIVE`, `MATCH`,
 * `DIRECTOR`, `TIMING`, `EFFECTS` and `RENDER` (mirrors `reprocessAsset` in
 * `@memetize/media-catalog`): otherwise `project inspect` would show
 * narrative segments, shortlists, a timeline, or an MP4 derived from stale
 * upstream data. `director` never drops `segment_matches` /
 * `narrative_segments`, and `render` never drops `timeline_versions` —
 * only the jobs, so the chain re-runs against the *same* upstream data.
 * `timing` never drops the Director's raw version either — re-running it
 * just re-aligns the same picks against the same beats/downbeats.
 * `effects` never drops the timed version — it only rewrites `clip.effects`
 * on a new append-only row.
 */
const STAGE_JOBS: Record<ReprocessStage, JobType[]> = {
  audio: ['AUDIO_ANALYZE', 'NARRATIVE', 'MATCH', 'DIRECTOR', 'TIMING', 'EFFECTS', 'RENDER'],
  lyrics: ['LYRICS', 'SUBTITLES', 'NARRATIVE', 'MATCH', 'DIRECTOR', 'TIMING', 'EFFECTS', 'RENDER'],
  subtitles: ['SUBTITLES', 'RENDER'],
  narrative: ['NARRATIVE', 'MATCH', 'DIRECTOR', 'TIMING', 'EFFECTS', 'RENDER'],
  match: ['MATCH', 'DIRECTOR', 'TIMING', 'EFFECTS', 'RENDER'],
  director: ['DIRECTOR', 'TIMING', 'EFFECTS', 'RENDER'],
  timing: ['TIMING', 'EFFECTS', 'RENDER'],
  effects: ['EFFECTS', 'RENDER'],
  render: ['RENDER'],
};

export interface ReprocessOutcome {
  /** The new active generation every enqueued job belongs to. */
  generationId: string;
  /** Jobs of the stage that were PENDING and are now CANCELLED (history kept). */
  cancelled: number;
}

/**
 * `project reprocess --from <stage>` (spec section 42): starts a new generation
 * (F09/F11) and enqueues the stage's first job for it. The whole command runs
 * under the per-project lock so concurrent reprocess/generate/render/swap calls
 * serialize instead of racing. Jobs are never deleted: PENDING jobs of the
 * superseded stages become CANCELLED, COMPLETED ones stay as history, and a
 * RUNNING one makes the command refuse (`ProjectBusyError`) — an active handler
 * is never pulled out from under itself. Because the generation id is part of
 * every job's idempotency key, a fresh job is created even when a previous
 * generation already COMPLETED the same step with the same input (this is also
 * how `project generate` forces a new `timeline_versions` row).
 *
 * Inputs are pinned at enqueue time (F11): `timing`/`effects`/`render` carry the
 * timeline version they must consume and `render` the edit window version it must
 * validate against, both read under the same lock, so an edit that lands before
 * the job is claimed cannot change what it renders.
 */
export async function reprocessProject(
  db: Executor,
  projectId: string,
  from: ReprocessStage,
): Promise<ReprocessOutcome> {
  const stageJobs = STAGE_JOBS[from];
  const needsAudio = from === 'audio' || from === 'lyrics';
  const audio = needsAudio ? await getProjectAudio(db, projectId) : undefined;
  if (needsAudio && !audio) {
    throw new ProjectStateError('NO_AUDIO', `project ${projectId} has no audio yet`);
  }

  return db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    // A RUNNING SUBTITLES job blocks render the same way other stage jobs do
    // (translated-subtitles spec) without cancelling the translation.
    const busyTypes = from === 'render' ? [...stageJobs, 'SUBTITLES' as const] : stageJobs;
    if ((await countRunningForEntity(tx, projectId, busyTypes)) > 0) {
      throw new ProjectBusyError(projectId);
    }
    const cancelled = await cancelActiveJobsForEntity(tx, projectId, stageJobs, ['PENDING']);
    const generationId = await startProjectGeneration(tx, projectId);
    const enqueue = (type: JobType, input: Record<string, unknown>) =>
      enqueueJob(tx, {
        type,
        entityId: projectId,
        input,
        generationId,
        stepKey: stepKeyFor(type),
      });

    switch (from) {
      case 'render': {
        const timeline = await getLatestTimeline(tx, projectId);
        const window = await getLatestEditWindow(tx, projectId);
        await enqueue('RENDER', {
          projectId,
          ...(timeline ? { sourceTimelineVersion: timeline.version } : {}),
          ...(window ? { editWindowVersion: window.version } : {}),
        });
        break;
      }
      case 'timing':
      case 'effects': {
        const timeline = await getLatestTimeline(tx, projectId);
        await enqueue(from === 'timing' ? 'TIMING' : 'EFFECTS', {
          projectId,
          ...(timeline ? { sourceTimelineVersion: timeline.version } : {}),
        });
        break;
      }
      case 'director':
        await enqueue('DIRECTOR', { projectId });
        break;
      case 'match':
        await enqueue('MATCH', { projectId });
        break;
      case 'narrative':
        await enqueue('NARRATIVE', { projectId });
        break;
      case 'audio':
        await enqueue('AUDIO_ANALYZE', {
          projectId,
          // biome-ignore lint/style/noNonNullAssertion: guarded above.
          originalPath: audio!.originalPath,
          // biome-ignore lint/style/noNonNullAssertion: guarded above.
          durationMs: audio!.durationMs,
        });
        break;
      case 'subtitles':
        await enqueue('SUBTITLES', { projectId });
        break;
      case 'lyrics':
        await enqueue('LYRICS', {
          projectId,
          // biome-ignore lint/style/noNonNullAssertion: guarded above.
          lyricsPath: audio!.lyricsPath,
          // biome-ignore lint/style/noNonNullAssertion: guarded above.
          originalPath: audio!.originalPath,
          // biome-ignore lint/style/noNonNullAssertion: guarded above.
          durationMs: audio!.durationMs,
        });
        break;
    }
    return { generationId, cancelled: cancelled.length };
  });
}
