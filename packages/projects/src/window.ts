import { type EditWindowSelection, ManualWindowInput } from '@memetize/contracts';
import { type Database, type EditWindowRow, editWindows, projects } from '@memetize/database';
import {
  type HighlightSelectionInput,
  scoreEditWindow,
  selectEditWindow,
} from '@memetize/edit-planner';
import { editWindowId } from '@memetize/shared';
import { desc, eq } from 'drizzle-orm';
import { getAudioAnalysis } from './audio';
import { assertProjectIdle } from './busy';
import { getProject } from './projects';
import { reprocessProject } from './reprocess';

export const MANUAL_SELECTOR = 'manual';
export const MANUAL_SELECTOR_VERSION = '1.0.0';

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

export class ManualWindowError extends Error {
  constructor(
    readonly code: 'NO_AUDIO' | 'INVALID_INPUT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ManualWindowError';
  }
}

/**
 * Checks a manual window against the contract and the track length. Returns
 * the parsed window or throws `ManualWindowError`.
 */
export function validateManualWindow(input: unknown, trackDurationMs: number): ManualWindowInput {
  const parsed = ManualWindowInput.safeParse(input);
  if (!parsed.success) {
    throw new ManualWindowError(
      'INVALID_INPUT',
      parsed.error.issues.map((issue) => issue.message).join('; '),
    );
  }
  if (parsed.data.sourceEndMs > trackDurationMs) {
    throw new ManualWindowError(
      'INVALID_INPUT',
      `sourceEndMs (${parsed.data.sourceEndMs}) is past the track (${trackDurationMs} ms)`,
    );
  }
  return parsed.data;
}

/**
 * The window NARRATIVE should analyze (manual-window spec): the editor's
 * pick when the project carries one, otherwise the highlight selector's.
 * A manual pick is scored with the same weights so the Studio can compare.
 */
export async function resolveEditWindow(
  db: Database,
  projectId: string,
  input: HighlightSelectionInput,
): Promise<EditWindowSelection> {
  const project = await getProject(db, projectId);
  if (!project) throw new ManualWindowError('NOT_FOUND', `project not found: ${projectId}`);
  if (project.manualWindowStartMs === null || project.manualWindowEndMs === null) {
    return selectEditWindow(input);
  }
  const manual = validateManualWindow(
    { sourceStartMs: project.manualWindowStartMs, sourceEndMs: project.manualWindowEndMs },
    input.trackDurationMs,
  );
  return {
    ...scoreEditWindow(manual.sourceStartMs, manual.sourceEndMs, input),
    selector: MANUAL_SELECTOR,
    selectorVersion: MANUAL_SELECTOR_VERSION,
  };
}

/**
 * Records the editor's window on the project and reruns the pipeline from
 * `narrative`, since every later stage is scoped to the window. Refuses
 * while a job is RUNNING.
 */
export async function setManualWindow(
  db: Database,
  projectId: string,
  input: unknown,
): Promise<ManualWindowInput> {
  const project = await getProject(db, projectId);
  if (!project) throw new ManualWindowError('NOT_FOUND', `project not found: ${projectId}`);
  const audio = await getAudioAnalysis(db, projectId);
  if (!audio) {
    throw new ManualWindowError('NO_AUDIO', `project ${projectId} has no audio analysis yet`);
  }
  const window = validateManualWindow(input, audio.durationMs);
  await assertProjectIdle(db, projectId);
  await db
    .update(projects)
    .set({
      manualWindowStartMs: window.sourceStartMs,
      manualWindowEndMs: window.sourceEndMs,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
  await reprocessProject(db, projectId, 'narrative');
  return window;
}

/** Returns the project to the automatic window and reruns from `narrative`. */
export async function clearManualWindow(db: Database, projectId: string): Promise<void> {
  const project = await getProject(db, projectId);
  if (!project) throw new ManualWindowError('NOT_FOUND', `project not found: ${projectId}`);
  await assertProjectIdle(db, projectId);
  await db
    .update(projects)
    .set({ manualWindowStartMs: null, manualWindowEndMs: null, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  await reprocessProject(db, projectId, 'narrative');
}
