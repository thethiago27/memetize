import type { RenderValidation } from '@memetize/contracts';
import {
  type Executor,
  type NewRenderRow,
  type RenderRow,
  renders as rendersTable,
} from '@memetize/database';
import { reserveVersion } from '@memetize/job-system';
import { renderId } from '@memetize/shared';
import { desc, eq } from 'drizzle-orm';
import { ProjectStateError } from './busy';
import { lockProject } from './coordinate';
import { reprocessProject } from './reprocess';
import { getLatestTimeline } from './timeline';

export interface InsertRenderParams {
  projectId: string;
  timelineVersion: number;
  /**
   * Builds the render's stored (repo-relative) path from the version reserved
   * under the entity lock. The version and therefore the destination are only
   * known atomically here (F09), so the caller renders to an exclusive temp file
   * first — two concurrent renders can never target the same file.
   */
  pathForVersion: (version: number) => string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  renderer: string;
  rendererVersion: string;
  validation: RenderValidation;
  /**
   * Moves the validated artifact to `row.path` after the row is inserted and
   * before the transaction commits (F09). A throw rolls the row back, so the
   * database never announces a render whose file is not in place; a crash after
   * the move but before commit leaves only an orphan file at a version number the
   * next reservation reuses (rename replaces it atomically).
   */
  publishFile?: (row: RenderRow) => Promise<void>;
}

/**
 * Append-only insert (spec section 39, mirrors `insertTimelineVersion`):
 * `renders` never gets overwritten. The version is reserved from the project's
 * coordination counter under the per-project lock (F09), floored at
 * `max(version) + 1`, and the stored path is derived from it so the destination
 * is unique. Accepts a transaction handle so the worker publishes the row, the
 * file move, the job completion and the project status in one transaction.
 */
export async function insertRender(db: Executor, params: InsertRenderParams): Promise<RenderRow> {
  return db.transaction(async (tx) => {
    await lockProject(tx, params.projectId);
    const [latest] = await tx
      .select({ version: rendersTable.version })
      .from(rendersTable)
      .where(eq(rendersTable.projectId, params.projectId))
      .orderBy(desc(rendersTable.version))
      .limit(1);
    const version = await reserveVersion(
      tx,
      'project',
      params.projectId,
      'render',
      (latest?.version ?? 0) + 1,
    );

    const row: NewRenderRow = {
      id: renderId(),
      projectId: params.projectId,
      version,
      timelineVersion: params.timelineVersion,
      path: params.pathForVersion(version),
      durationMs: params.durationMs,
      width: params.width,
      height: params.height,
      fps: params.fps,
      videoCodec: params.videoCodec,
      audioCodec: params.audioCodec,
      renderer: params.renderer,
      rendererVersion: params.rendererVersion,
      validation: params.validation,
    };

    const inserted = await tx.insert(rendersTable).values(row).returning();
    const persisted = inserted[0];
    if (!persisted) throw new Error('failed to insert render');
    if (params.publishFile) await params.publishFile(persisted);
    return persisted;
  });
}

/** The highest-numbered render for a project (spec section 35's pattern: `inspect` always reads this one). */
export function getLatestRender(db: Executor, projectId: string): Promise<RenderRow | undefined> {
  return db.query.renders.findFirst({
    where: eq(rendersTable.projectId, projectId),
    orderBy: desc(rendersTable.version),
  });
}

export function listRenders(db: Executor, projectId: string): Promise<RenderRow[]> {
  return db.query.renders.findMany({
    where: eq(rendersTable.projectId, projectId),
    orderBy: desc(rendersTable.version),
  });
}

/**
 * `project render <projectId>` (spec section 42): starts a new generation from
 * the `render` stage, pinned to the latest timeline and edit window at the time
 * of the command (F11). Requires a timeline first: without one there is nothing
 * to render.
 */
export async function renderProject(db: Executor, projectId: string): Promise<void> {
  const timeline = await getLatestTimeline(db, projectId);
  if (!timeline) {
    throw new ProjectStateError(
      'NO_TIMELINE',
      `project ${projectId} has no timeline yet — run 'project create' or 'project generate' first`,
    );
  }
  await reprocessProject(db, projectId, 'render');
}
