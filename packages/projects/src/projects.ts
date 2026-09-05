import type { ProjectStatus } from '@memetize/contracts';
import {
  type Executor,
  type ProjectAudioRow,
  type ProjectRow,
  projectAudio,
  projects,
} from '@memetize/database';
import { desc, eq } from 'drizzle-orm';

export function getProject(db: Executor, id: string): Promise<ProjectRow | undefined> {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

export function listProjects(db: Executor): Promise<ProjectRow[]> {
  return db.query.projects.findMany({ orderBy: desc(projects.createdAt) });
}

export async function setProjectStatus(
  db: Executor,
  id: string,
  status: ProjectStatus,
): Promise<void> {
  await db.update(projects).set({ status, updatedAt: new Date() }).where(eq(projects.id, id));
}

export function getProjectAudio(
  db: Executor,
  projectId: string,
): Promise<ProjectAudioRow | undefined> {
  return db.query.projectAudio.findFirst({ where: eq(projectAudio.projectId, projectId) });
}
