import {
  type Executor,
  type TimelineVersionRow,
  timelineVersions as timelineVersionsTable,
} from '@memetize/database';
import { reserveVersion, setCurrentTimelineVersion } from '@memetize/job-system';
import { timelineVersionId } from '@memetize/shared';
import type { Timeline } from '@memetize/timeline';
import { and, desc, eq } from 'drizzle-orm';
import { lockProject } from './coordinate';

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
  /** Set only by the Effects Planner (spec sections 33, 57, phase 9); `null`
   * on Director/Timing versions that have not been planned yet. */
  effectsPlanner?: string | null;
  effectsPlannerVersion?: string | null;
}

/**
 * Append-only insert (spec section 35): `timeline_versions` never gets
 * overwritten. The version number is reserved from the project's coordination
 * counter under the per-project lock (F09) — floored at `max(version) + 1` read
 * in the same transaction so history written before the counter existed is never
 * collided with — and the insert happens in that same transaction. Accepts a
 * transaction handle so a command (swap, worker publication) can commit the
 * timeline together with its feedback events and follow-up jobs.
 */
export async function insertTimelineVersion(
  db: Executor,
  params: InsertTimelineVersionParams,
): Promise<TimelineVersionRow> {
  return db.transaction(async (tx) => {
    await lockProject(tx, params.projectId);
    const [latest] = await tx
      .select({ version: timelineVersionsTable.version })
      .from(timelineVersionsTable)
      .where(eq(timelineVersionsTable.projectId, params.projectId))
      .orderBy(desc(timelineVersionsTable.version))
      .limit(1);
    const version = await reserveVersion(
      tx,
      'project',
      params.projectId,
      'timeline',
      (latest?.version ?? 0) + 1,
    );

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
        effectsPlanner: params.effectsPlanner ?? null,
        effectsPlannerVersion: params.effectsPlannerVersion ?? null,
      })
      .returning();
    const persisted = inserted[0];
    if (!persisted) throw new Error('failed to insert timeline version');
    await setCurrentTimelineVersion(tx, 'project', params.projectId, version);
    return persisted;
  });
}

/** The highest-numbered version for a project (spec section 35: `inspect`/`generate` always read this one). */
export function getLatestTimeline(
  db: Executor,
  projectId: string,
): Promise<TimelineVersionRow | undefined> {
  return db.query.timelineVersions.findFirst({
    where: eq(timelineVersionsTable.projectId, projectId),
    orderBy: desc(timelineVersionsTable.version),
  });
}

/**
 * One specific version (F11): pipeline stages load the version their job was
 * pinned to instead of "latest", so an edit that lands between enqueue and claim
 * cannot change what the stage consumes.
 */
export function getTimelineVersion(
  db: Executor,
  projectId: string,
  version: number,
): Promise<TimelineVersionRow | undefined> {
  return db.query.timelineVersions.findFirst({
    where: and(
      eq(timelineVersionsTable.projectId, projectId),
      eq(timelineVersionsTable.version, version),
    ),
  });
}

/**
 * Resolves a stage's source timeline: the pinned version when the job carries
 * one (missing means the history it was enqueued against is gone — fail, do not
 * silently fall back), otherwise the latest (legacy jobs without a pin).
 */
export async function resolveSourceTimeline(
  db: Executor,
  projectId: string,
  pinnedVersion: number | undefined,
): Promise<{ row: TimelineVersionRow | undefined; pinned: boolean }> {
  if (pinnedVersion !== undefined) {
    return { row: await getTimelineVersion(db, projectId, pinnedVersion), pinned: true };
  }
  return { row: await getLatestTimeline(db, projectId), pinned: false };
}

export function listTimelineVersions(
  db: Executor,
  projectId: string,
): Promise<TimelineVersionRow[]> {
  return db.query.timelineVersions.findMany({
    where: eq(timelineVersionsTable.projectId, projectId),
    orderBy: desc(timelineVersionsTable.version),
  });
}
