import {
  createTestDatabase,
  type Database,
  projectAudio,
  projects,
  truncateAll,
} from '@memetize/database';
import { claimNextJob, enqueueJob, listJobsForEntity } from '@memetize/job-system';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { replaceAudioAnalysis } from './audio';
import { ProjectBusyError } from './busy';
import { getProject } from './projects';
import {
  clearManualWindow,
  MANUAL_SELECTOR,
  ManualWindowError,
  resolveEditWindow,
  setManualWindow,
} from './window';

const handle = await createTestDatabase();
const db = handle?.db as Database;

const analysis = {
  durationMs: 120_000,
  bpm: 120,
  beats: [
    { timeMs: 0, strength: 0.2 },
    { timeMs: 60_000, strength: 1 },
  ],
  downbeats: [0, 60_000],
  sections: [
    { type: 'intro', startMs: 0, endMs: 60_000 },
    { type: 'chorus', startMs: 60_000, endMs: 120_000 },
  ],
  energyCurve: [
    { timeMs: 0, value: 0.1 },
    { timeMs: 60_000, value: 0.9 },
  ],
};

const selectionInput = {
  trackDurationMs: analysis.durationMs,
  sections: analysis.sections,
  beats: analysis.beats,
  downbeats: analysis.downbeats,
  energyCurve: analysis.energyCurve,
  lyrics: [],
};

async function seedProject(id: string, withAudio = true): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'PLANNING' });
  await db.insert(projectAudio).values({
    projectId: id,
    originalPath: `storage/audio/${id}/original.mp3`,
    lyricsPath: null,
    checksum: 'checksum',
    durationMs: analysis.durationMs,
  });
  if (withAudio) {
    await replaceAudioAnalysis(db, {
      projectId: id,
      ...analysis,
      analyzer: 'fixture',
      analyzerVersion: '1.0.0',
    });
  }
}

describe.skipIf(!handle)('manual edit window (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('resolves to the automatic selector when the project has no manual window', async () => {
    await seedProject('prj_mw_auto');
    const selection = await resolveEditWindow(db, 'prj_mw_auto', selectionInput);
    expect(selection.selector).toBe('structural-highlight');
    expect(selection.durationMs).toBe(60_000);
  });

  it('resolves to the manual window, scored, when the project carries one', async () => {
    await seedProject('prj_mw_manual');
    await db
      .update(projects)
      .set({ manualWindowStartMs: 10_000, manualWindowEndMs: 40_000 })
      .where(eq(projects.id, 'prj_mw_manual'));
    const selection = await resolveEditWindow(db, 'prj_mw_manual', selectionInput);
    expect(selection).toMatchObject({
      sourceStartMs: 10_000,
      sourceEndMs: 40_000,
      durationMs: 30_000,
      targetDurationMs: 30_000,
      selector: MANUAL_SELECTOR,
    });
    expect(selection.score).toBeGreaterThanOrEqual(0);
  });

  it('setManualWindow stores the pick, drops downstream jobs, and enqueues a fresh NARRATIVE', async () => {
    const projectId = 'prj_mw_set';
    await seedProject(projectId);
    const { job: director } = await enqueueJob(db, {
      type: 'DIRECTOR',
      entityId: projectId,
      input: { projectId },
    });

    const window = await setManualWindow(db, projectId, {
      sourceStartMs: 30_000,
      sourceEndMs: 75_000,
    });
    expect(window).toEqual({ sourceStartMs: 30_000, sourceEndMs: 75_000 });

    const project = await getProject(db, projectId);
    expect(project?.manualWindowStartMs).toBe(30_000);
    expect(project?.manualWindowEndMs).toBe(75_000);

    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.find((job) => job.id === director.id)).toBeUndefined();
    expect(jobs.filter((job) => job.type === 'NARRATIVE')).toHaveLength(1);
    expect(jobs.find((job) => job.type === 'NARRATIVE')?.status).toBe('PENDING');
  });

  it('rejects a window past the track, too short, or before audio analysis exists', async () => {
    await seedProject('prj_mw_bad');
    await expect(
      setManualWindow(db, 'prj_mw_bad', { sourceStartMs: 100_000, sourceEndMs: 130_000 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      setManualWindow(db, 'prj_mw_bad', { sourceStartMs: 0, sourceEndMs: 4_000 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await seedProject('prj_mw_noaudio', false);
    await expect(
      setManualWindow(db, 'prj_mw_noaudio', { sourceStartMs: 0, sourceEndMs: 10_000 }),
    ).rejects.toMatchObject({ code: 'NO_AUDIO' });

    await expect(
      setManualWindow(db, 'prj_mw_missing', { sourceStartMs: 0, sourceEndMs: 10_000 }),
    ).rejects.toBeInstanceOf(ManualWindowError);
  });

  it('clearManualWindow nulls the pick and enqueues NARRATIVE again', async () => {
    const projectId = 'prj_mw_clear';
    await seedProject(projectId);
    await setManualWindow(db, projectId, { sourceStartMs: 0, sourceEndMs: 20_000 });
    await clearManualWindow(db, projectId);

    const project = await getProject(db, projectId);
    expect(project?.manualWindowStartMs).toBeNull();
    expect(project?.manualWindowEndMs).toBeNull();
    const jobs = await listJobsForEntity(db, projectId);
    expect(jobs.filter((job) => job.type === 'NARRATIVE')).toHaveLength(1);
  });

  it('refuses both operations while a job is RUNNING', async () => {
    const projectId = 'prj_mw_busy';
    await seedProject(projectId);
    await enqueueJob(db, { type: 'MATCH', entityId: projectId, input: { projectId } });
    await claimNextJob(db, { entityId: projectId, types: ['MATCH'] });

    await expect(
      setManualWindow(db, projectId, { sourceStartMs: 0, sourceEndMs: 20_000 }),
    ).rejects.toBeInstanceOf(ProjectBusyError);
    await expect(clearManualWindow(db, projectId)).rejects.toBeInstanceOf(ProjectBusyError);
  });
});
