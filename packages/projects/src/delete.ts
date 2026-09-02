import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type Database, jobs, projects } from '@memetize/database';
import type { AppConfig } from '@memetize/shared';
import { and, eq } from 'drizzle-orm';
import { audioDir, renderDir } from './paths';
import { getProject } from './projects';

export class ProjectBusyError extends Error {
  readonly code = 'PROJECT_BUSY';
  constructor(projectId: string) {
    super(`project ${projectId} has a job running; wait for it to finish before deleting`);
    this.name = 'ProjectBusyError';
  }
}

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

  const running = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.entityId, projectId), eq(jobs.status, 'RUNNING')))
    .limit(1);
  if (running.length > 0) throw new ProjectBusyError(projectId);

  await db.transaction(async (tx) => {
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
