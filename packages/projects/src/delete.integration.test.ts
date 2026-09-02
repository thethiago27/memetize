import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  audioAnalysis,
  createTestDatabase,
  type Database,
  projectAudio,
  projects,
  truncateAll,
} from '@memetize/database';
import { claimNextJob, enqueueJob, listJobsForEntity } from '@memetize/job-system';
import { type AppConfig, loadConfig } from '@memetize/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getAudioAnalysis } from './audio';
import { ProjectBusyError } from './busy';
import { deleteProject } from './delete';
import { audioDir, renderDir } from './paths';
import { getProject } from './projects';

const handle = await createTestDatabase();
const db = handle?.db as Database;

function testConfig(): AppConfig {
  const base = loadConfig();
  const storageDir = join(base.storageDir, 'test-delete');
  return { ...base, storageDir };
}

async function seedProject(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'PLANNING' });
  await db.insert(projectAudio).values({
    projectId: id,
    originalPath: `storage/audio/${id}/original.mp3`,
    lyricsPath: null,
    checksum: 'checksum',
    durationMs: 4000,
  });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe.skipIf(!handle)('deleteProject (integration)', () => {
  const config = testConfig();

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('returns false for an unknown project', async () => {
    await expect(deleteProject({ db, config, projectId: 'prj_missing' })).resolves.toBe(false);
  });

  it('removes the project, its derived rows, its jobs, and its storage directories', async () => {
    const projectId = 'prj_delete_me';
    await seedProject(db, projectId);
    await db.insert(audioAnalysis).values({
      id: 'aud_delete_me',
      projectId,
      durationMs: 4000,
      bpm: 120,
      analyzer: 'fixture',
      analyzerVersion: '1.0.0',
    });
    await enqueueJob(db, { type: 'NARRATIVE', entityId: projectId, input: { projectId } });

    const dirs = [
      audioDir(config, projectId).absolute,
      renderDir(config, projectId).absolute,
      join(config.storageDir, 'cache', projectId),
    ];
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'file.bin'), 'x');
    }

    await expect(deleteProject({ db, config, projectId })).resolves.toBe(true);

    expect(await getProject(db, projectId)).toBeUndefined();
    expect(await getAudioAnalysis(db, projectId)).toBeUndefined();
    expect(await listJobsForEntity(db, projectId)).toEqual([]);
    for (const dir of dirs) expect(await exists(dir)).toBe(false);
  });

  it('refuses while a job is RUNNING', async () => {
    const projectId = 'prj_delete_busy';
    await seedProject(db, projectId);
    await enqueueJob(db, { type: 'NARRATIVE', entityId: projectId, input: { projectId } });
    await claimNextJob(db, { entityId: projectId, types: ['NARRATIVE'] });

    await expect(deleteProject({ db, config, projectId })).rejects.toBeInstanceOf(ProjectBusyError);
    expect(await getProject(db, projectId)).toBeDefined();
  });
});
