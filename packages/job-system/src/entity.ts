import type { JobStatus } from '@memetize/contracts';
import { type EntityExecutionRow, type Executor, entityExecution, jobs } from '@memetize/database';
import { generationId as newGenerationId } from '@memetize/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { GenerationSupersededError } from './errors';

export type EntityKind = 'project' | 'asset';

export type { Executor };

/**
 * Ensures the per-entity coordination row exists (F09). Created with the entity;
 * idempotent, so re-running is safe. A missing row means no mutual exclusion was
 * ever acquired, so every writer must call this (or rely on the entity's
 * creation having done so) before locking.
 */
export async function ensureEntityExecution(
  db: Executor,
  kind: EntityKind,
  entityId: string,
): Promise<void> {
  await db
    .insert(entityExecution)
    .values({ entityKind: kind, entityId })
    .onConflictDoNothing({ target: [entityExecution.entityKind, entityExecution.entityId] });
}

/**
 * Acquires the per-entity lock for the current transaction (`FOR UPDATE`) and
 * returns the coordination row. Must be called inside a transaction; the lock is
 * held only for that (short) transaction, never across an LLM/FFmpeg call.
 * Throws when the row is absent, because a query that found nothing did not
 * acquire the lock.
 */
export async function lockEntity(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
): Promise<EntityExecutionRow> {
  const rows = await tx
    .select()
    .from(entityExecution)
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)))
    .for('update');
  const row = rows[0];
  if (!row) {
    throw new Error(`entity_execution row missing for ${kind}:${entityId}`);
  }
  return row;
}

type VersionCounter = 'render' | 'timeline' | 'window';

const COUNTER_COLUMN = {
  render: entityExecution.nextRenderVersion,
  timeline: entityExecution.nextTimelineVersion,
  window: entityExecution.nextWindowVersion,
} as const;

/**
 * Reserves the next version number for an append-only series under the entity
 * lock (F09). The reservation is `max(counter, floor)`, where `floor` is
 * `max(existing version) + 1` read by the caller in the same transaction, so a
 * counter that predates the history (or a lazily created coordination row) can
 * never hand out a version the unique index already holds. Gaps are fine: a
 * reserved render version whose transaction rolls back is simply skipped.
 */
export async function reserveVersion(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
  counter: VersionCounter,
  floor: number,
): Promise<number> {
  const column = COUNTER_COLUMN[counter];
  const next = sql`greatest(${column}, ${floor}) + 1`;
  const patch =
    counter === 'render'
      ? { nextRenderVersion: next }
      : counter === 'timeline'
        ? { nextTimelineVersion: next }
        : { nextWindowVersion: next };
  const rows = await tx
    .update(entityExecution)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)))
    .returning({ next: column });
  const reservedNext = rows[0]?.next;
  if (reservedNext === undefined) {
    throw new Error(`cannot reserve ${counter} version for ${kind}:${entityId}`);
  }
  return Number(reservedNext) - 1;
}

/** Records the timeline version the entity currently points at (under the lock). */
export async function setCurrentTimelineVersion(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
  version: number,
): Promise<void> {
  await tx
    .update(entityExecution)
    .set({ currentTimelineVersion: version, updatedAt: new Date() })
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)));
}

/**
 * Starts a new generation for the entity and makes it the active one (F09/F11).
 * Must run under the entity lock. Jobs enqueued for the pipeline carry this id
 * (in their payload, so the idempotency hash differs per generation, and in
 * `generation_id`), and every publication checks that it is still active.
 */
export async function startGeneration(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
): Promise<string> {
  const generationId = newGenerationId();
  await tx
    .update(entityExecution)
    .set({ activeGenerationId: generationId, updatedAt: new Date() })
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)));
  return generationId;
}

/** The entity's active generation id, or null when no pipeline has started. */
export async function getActiveGeneration(
  db: Executor,
  kind: EntityKind,
  entityId: string,
): Promise<string | null> {
  const rows = await db
    .select({ active: entityExecution.activeGenerationId })
    .from(entityExecution)
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)));
  return rows[0]?.active ?? null;
}

/**
 * True when the given generation is still the entity's active one. A terminal
 * failure from an old generation must not overwrite a newer generation's state
 * (F08/F09). A `null` generation is a legacy job from before generations were
 * recorded; it is treated as current because nothing newer can be proven.
 */
export async function isGenerationActive(
  db: Executor,
  kind: EntityKind,
  entityId: string,
  generationId: string | null,
): Promise<boolean> {
  if (generationId === null) return true;
  const active = await getActiveGeneration(db, kind, entityId);
  return active === null || active === generationId;
}

/**
 * Throws `GenerationSupersededError` when the job's generation is no longer the
 * active one. Called inside the publication transaction, after the entity lock.
 */
export async function requireActiveGeneration(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
  generationId: string | null,
): Promise<void> {
  if (generationId === null) return;
  const active = await getActiveGeneration(tx, kind, entityId);
  if (active !== null && active !== generationId) {
    throw new GenerationSupersededError(entityId, generationId, active);
  }
}

/** Status of every logical step enqueued for a generation, keyed by step key. */
export async function listStepStates(
  db: Executor,
  entityId: string,
  generationId: string,
): Promise<Map<string, JobStatus>> {
  const rows = await db
    .select({ stepKey: jobs.stepKey, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.entityId, entityId), eq(jobs.generationId, generationId)));
  const states = new Map<string, JobStatus>();
  for (const row of rows) if (row.stepKey !== null) states.set(row.stepKey, row.status);
  return states;
}

/**
 * Whether a fan-in dependency is satisfied for a generation (F10). The step is
 * satisfied when it COMPLETED in this generation, or — when the generation never
 * enqueued it (a `reprocess --from lyrics` inherits the previous AUDIO_ANALYZE) —
 * when the entity's most recent job of that type is COMPLETED. A step that this
 * generation did enqueue but has not finished is never satisfied by history.
 */
export async function isStepSatisfied(
  db: Executor,
  args: { entityId: string; generationId: string; stepKey: string; type: string },
): Promise<boolean> {
  const states = await listStepStates(db, args.entityId, args.generationId);
  const own = states.get(args.stepKey);
  if (own !== undefined) return own === 'COMPLETED';
  const latest = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.entityId, args.entityId), sql`${jobs.type} = ${args.type}`))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return latest[0]?.status === 'COMPLETED';
}
