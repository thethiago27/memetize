import type { RenderValidation } from '@memetize/contracts';
import {
  type Database,
  type NewRenderRow,
  type RenderRow,
  renders as rendersTable,
} from '@memetize/database';
import { renderId } from '@memetize/shared';
import { desc, eq } from 'drizzle-orm';
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
   * first and moves it to this path after the row is inserted — two concurrent
   * renders can never target the same file.
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
}

/**
 * Append-only insert (spec section 39, mirrors `insertTimelineVersion`):
 * `renders` never gets overwritten, so `version` is `max(version) + 1` under the
 * per-project lock (F09), and the stored path is derived from that reserved
 * version so the destination is unique.
 */
export async function insertRender(db: Database, params: InsertRenderParams): Promise<RenderRow> {
  return db.transaction(async (tx) => {
    await lockProject(tx, params.projectId);
    const [latest] = await tx
      .select({ version: rendersTable.version })
      .from(rendersTable)
      .where(eq(rendersTable.projectId, params.projectId))
      .orderBy(desc(rendersTable.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;

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
    return persisted;
  });
}

/** The highest-numbered render for a project (spec section 35's pattern: `inspect` always reads this one). */
export function getLatestRender(db: Database, projectId: string): Promise<RenderRow | undefined> {
  return db.query.renders.findFirst({
    where: eq(rendersTable.projectId, projectId),
    orderBy: desc(rendersTable.version),
  });
}

export function listRenders(db: Database, projectId: string): Promise<RenderRow[]> {
  return db.query.renders.findMany({
    where: eq(rendersTable.projectId, projectId),
    orderBy: desc(rendersTable.version),
  });
}

/**
 * `project render <projectId>` (spec section 42): forces a fresh `RENDER`
 * run — and therefore a new `renders` row — even when the previous run
 * already COMPLETED with the same `inputHash`. Requires a timeline first:
 * without one there is nothing to render.
 */
export async function renderProject(db: Database, projectId: string): Promise<void> {
  const timeline = await getLatestTimeline(db, projectId);
  if (!timeline) {
    throw new Error(
      `project ${projectId} has no timeline yet — run 'project create' or 'project generate' first`,
    );
  }
  await reprocessProject(db, projectId, 'render');
}
