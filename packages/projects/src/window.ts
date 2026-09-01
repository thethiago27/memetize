import type { EditWindowSelection } from '@memetize/contracts';
import { type Database, type EditWindowRow, editWindows } from '@memetize/database';
import { editWindowId } from '@memetize/shared';
import { desc, eq } from 'drizzle-orm';

export async function insertEditWindow(
  db: Database,
  params: { projectId: string; selection: EditWindowSelection },
): Promise<EditWindowRow> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: editWindows.version })
      .from(editWindows)
      .where(eq(editWindows.projectId, params.projectId))
      .orderBy(desc(editWindows.version))
      .limit(1);
    const [row] = await tx
      .insert(editWindows)
      .values({
        id: editWindowId(),
        projectId: params.projectId,
        version: (latest?.version ?? 0) + 1,
        ...params.selection,
      })
      .returning();
    if (!row) throw new Error('failed to insert edit window');
    return row;
  });
}

export function getLatestEditWindow(
  db: Database,
  projectId: string,
): Promise<EditWindowRow | undefined> {
  return db.query.editWindows.findFirst({
    where: eq(editWindows.projectId, projectId),
    orderBy: desc(editWindows.version),
  });
}

export function listEditWindows(db: Database, projectId: string): Promise<EditWindowRow[]> {
  return db.query.editWindows.findMany({
    where: eq(editWindows.projectId, projectId),
    orderBy: desc(editWindows.version),
  });
}
