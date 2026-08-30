import type { ProjectStatus } from '@memetize/contracts';
import {
  type Database,
  type ProjectAudioRow,
  type ProjectRow,
  projectAudio,
  projects,
} from '@memetize/database';
import { desc, eq } from 'drizzle-orm';

export function getProject(db: Database, id: string): Promise<ProjectRow | undefined> {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

export function listProjects(db: Database): Promise<ProjectRow[]> {
  return db.query.projects.findMany({ orderBy: desc(projects.createdAt) });
}

export async function setProjectStatus(
  db: Database,
  id: string,
  status: ProjectStatus,
): Promise<void> {
  await db.update(projects).set({ status, updatedAt: new Date() }).where(eq(projects.id, id));
}

export function getProjectAudio(
  db: Database,
  projectId: string,
): Promise<ProjectAudioRow | undefined> {
  return db.query.projectAudio.findFirst({ where: eq(projectAudio.projectId, projectId) });
}
