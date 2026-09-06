import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type Database, jobs, projects } from '@memetize/database';
import type { AppConfig } from '@memetize/shared';
import { eq } from 'drizzle-orm';
import { ProjectBusyError } from './busy';
import { lockProject } from './coordinate';
import { audioDir, renderDir } from './paths';
import { getProject } from './projects';

export interface DeleteProjectArgs {
  db: Database;
  config: AppConfig;
  projectId: string;
}

/**
 * Deletes a project: its jobs, every derived row (`project_audio`,
 * `audio_analysis`, `lyrics`, `narrative_segments`, `segment_matches`,
 * `timeline_versions`, `edit_windows`, `renders` all cascade from
 * `projects`), and its storage under `audio/`, `cache/`, and `renders/`.
 *
 * `feedback_events` are kept on purpose: editorial memory has no foreign key
 * to projects so lessons outlive their source (editorial-memory spec).
 *
 * Refuses while a job is RUNNING: an in-flight worker would otherwise write
 * into rows that no longer exist. PENDING jobs are simply dropped.
 *
 * Returns `false` when the project does not exist.
 */
export async function deleteProject({
  db,
  config,
  projectId,
}: DeleteProjectArgs): Promise<boolean> {
  const project = await getProject(db, projectId);
  if (!project) return false;

  await db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    // Lock every job row before deciding (F09). `claimNextJob` selects with
    // `FOR UPDATE SKIP LOCKED`, so while this transaction holds these rows a
    // concurrent claim skips them: no PENDING job can turn RUNNING between the
    // idle check and the delete, which would otherwise drop a job out from
    // under a live handler.
    const held = await tx
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.entityId, projectId))
      .for('update');
    if (held.some((job) => job.status === 'RUNNING')) throw new ProjectBusyError(projectId);

    await tx.delete(jobs).where(eq(jobs.entityId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });

  const dirs = [
    audioDir(config, projectId).absolute,
    renderDir(config, projectId).absolute,
    join(config.storageDir, 'cache', projectId),
  ];
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));

  return true;
}
