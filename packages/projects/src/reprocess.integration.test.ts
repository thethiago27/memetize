import {
  createTestDatabase,
  type Database,
  projectAudio,
  projects,
  truncateAll,
} from '@memetize/database';
import { claimNextJob, completeJob, enqueueJob, listJobsForEntity } from '@memetize/job-system';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reprocessProject } from './reprocess';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProjectWithAudio(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'ANALYZING_AUDIO' });
  await db.insert(projectAudio).values({
    projectId: id,
    originalPath: `storage/audio/${id}/original.mp3`,
    lyricsPath: `storage/audio/${id}/lyrics.lrc`,
    checksum: 'checksum',
    durationMs: 4000,
  });
}

describe.skipIf(!handle)('reprocessProject (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('reprocessing from "narrative" drops the old NARRATIVE job and enqueues a fresh one, without touching audio/lyrics', async () => {
    const projectId = 'prj_reprocess_narrative';
    await seedProjectWithAudio(db, projectId);

    const { job: original } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, original.id, { segmentCount: 3 });

    await reprocessProject(db, projectId, 'narrative');

    const jobs = await listJobsForEntity(db, projectId);
    const narrativeJobs = jobs.filter((job) => job.type === 'NARRATIVE');
    expect(narrativeJobs).toHaveLength(1);
    expect(narrativeJobs[0]?.id).not.toBe(original.id);
    expect(narrativeJobs[0]?.status).toBe('PENDING');
  });

  it('reprocessing from "lyrics" drops a completed downstream NARRATIVE job but leaves AUDIO_ANALYZE alone', async () => {
    const projectId = 'prj_reprocess_lyrics';
    await seedProjectWithAudio(db, projectId);

    const { job: audioJob } = await enqueueJob(db, {
      type: 'AUDIO_ANALYZE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['AUDIO_ANALYZE'] });
    await completeJob(db, audioJob.id, {});

    const { job: lyricsJob } = await enqueueJob(db, {
      type: 'LYRICS',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['LYRICS'] });
    await completeJob(db, lyricsJob.id, {});

    const { job: narrativeJob } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, narrativeJob.id, {});

    await reprocessProject(db, projectId, 'lyrics');

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.some((job) => job.type === 'NARRATIVE')).toBe(false);
    const audioJobs = jobs.filter((job) => job.type === 'AUDIO_ANALYZE');
    expect(audioJobs).toHaveLength(1);
    expect(audioJobs[0]?.id).toBe(audioJob.id);
    expect(audioJobs[0]?.status).toBe('COMPLETED');
    const lyricsJobs = jobs.filter((job) => job.type === 'LYRICS');
    expect(lyricsJobs).toHaveLength(1);
    expect(lyricsJobs[0]?.id).not.toBe(lyricsJob.id);
    expect(lyricsJobs[0]?.status).toBe('PENDING');
  });

  it('reprocessing from "narrative" also drops a completed downstream MATCH job', async () => {
    const projectId = 'prj_reprocess_narrative_match';
    await seedProjectWithAudio(db, projectId);

    const { job: narrativeJob } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, narrativeJob.id, { segmentCount: 3 });

    const { job: matchJob } = await enqueueJob(db, {
      type: 'MATCH',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['MATCH'] });
    await completeJob(db, matchJob.id, { shortlistCount: 9 });

    await reprocessProject(db, projectId, 'narrative');

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.some((job) => job.type === 'MATCH')).toBe(false);
    const narrativeJobs = jobs.filter((job) => job.type === 'NARRATIVE');
    expect(narrativeJobs).toHaveLength(1);
    expect(narrativeJobs[0]?.id).not.toBe(narrativeJob.id);
    expect(narrativeJobs[0]?.status).toBe('PENDING');
  });

  it('reprocessing from "match" drops only the MATCH job and re-enqueues it, without touching narrative', async () => {
    const projectId = 'prj_reprocess_match';
    await seedProjectWithAudio(db, projectId);

    const { job: narrativeJob } = await enqueueJob(db, {
      type: 'NARRATIVE',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });
    await completeJob(db, narrativeJob.id, { segmentCount: 3 });

    const { job: matchJob } = await enqueueJob(db, {
      type: 'MATCH',
      entityId: projectId,
      input: { projectId },
    });
    await claimNextJob(db, { entityId: projectId, types: ['MATCH'] });
    await completeJob(db, matchJob.id, { shortlistCount: 9 });

    await reprocessProject(db, projectId, 'match');

    const jobs = await listJobsForEntity(db, projectId);
    const narrativeJobs = jobs.filter((job) => job.type === 'NARRATIVE');
    expect(narrativeJobs).toHaveLength(1);
    expect(narrativeJobs[0]?.id).toBe(narrativeJob.id);
    expect(narrativeJobs[0]?.status).toBe('COMPLETED');

    const matchJobs = jobs.filter((job) => job.type === 'MATCH');
    expect(matchJobs).toHaveLength(1);
    expect(matchJobs[0]?.id).not.toBe(matchJob.id);
    expect(matchJobs[0]?.status).toBe('PENDING');
  });
});
