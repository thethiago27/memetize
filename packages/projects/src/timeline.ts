import {
  type Database,
  type TimelineVersionRow,
  timelineVersions as timelineVersionsTable,
} from '@memetize/database';
import { timelineVersionId } from '@memetize/shared';
import type { Timeline } from '@memetize/timeline';
import { desc, eq } from 'drizzle-orm';

export interface InsertTimelineVersionParams {
  projectId: string;
  data: Timeline;
  director: string;
  directorVersion: string;
  promptVersion: string;
  /** Set only by the Timing Optimizer (spec section 32, phase 8); `null` on
   * the Director's own raw version. */
  timingOptimizer?: string | null;
  timingOptimizerVersion?: string | null;
}

/**
 * Append-only insert (spec section 35): `timeline_versions` never gets
 * overwritten, so `version` is computed as `max(version) + 1` inside the
 * same transaction as the insert, keeping the read-then-write atomic
 * against a concurrent Director run for the same project.
 */
export async function insertTimelineVersion(
  db: Database,
  params: InsertTimelineVersionParams,
): Promise<TimelineVersionRow> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: timelineVersionsTable.version })
      .from(timelineVersionsTable)
      .where(eq(timelineVersionsTable.projectId, params.projectId))
      .orderBy(desc(timelineVersionsTable.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;

    const inserted = await tx
      .insert(timelineVersionsTable)
      .values({
        id: timelineVersionId(),
        projectId: params.projectId,
        version,
        data: params.data,
        director: params.director,
        directorVersion: params.directorVersion,
        promptVersion: params.promptVersion,
        timingOptimizer: params.timingOptimizer ?? null,
        timingOptimizerVersion: params.timingOptimizerVersion ?? null,
      })
      .returning();
    const persisted = inserted[0];
    if (!persisted) throw new Error('failed to insert timeline version');
    return persisted;
  });
}

/** The highest-numbered version for a project (spec section 35: `inspect`/`generate` always read this one). */
export function getLatestTimeline(
  db: Database,
  projectId: string,
): Promise<TimelineVersionRow | undefined> {
  return db.query.timelineVersions.findFirst({
    where: eq(timelineVersionsTable.projectId, projectId),
    orderBy: desc(timelineVersionsTable.version),
  });
}

export function listTimelineVersions(
  db: Database,
  projectId: string,
): Promise<TimelineVersionRow[]> {
  return db.query.timelineVersions.findMany({
    where: eq(timelineVersionsTable.projectId, projectId),
    orderBy: desc(timelineVersionsTable.version),
  });
}
