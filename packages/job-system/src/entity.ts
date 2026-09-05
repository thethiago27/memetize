import {
  type Database,
  type EntityExecutionRow,
  entityExecution,
  jobs,
} from '@memetize/database';
import { and, eq, sql } from 'drizzle-orm';

export type EntityKind = 'project' | 'asset';

/** A Drizzle executor: the root db or a transaction handle. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

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

/** Reserves the next render version atomically under the entity lock (F09). */
export async function reserveRenderVersion(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
): Promise<number> {
  const rows = await tx
    .update(entityExecution)
    .set({ nextRenderVersion: sql`${entityExecution.nextRenderVersion} + 1`, updatedAt: new Date() })
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)))
    .returning({ reserved: sql<number>`${entityExecution.nextRenderVersion} - 1` });
  const reserved = rows[0]?.reserved;
  if (reserved === undefined) throw new Error(`cannot reserve render version for ${kind}:${entityId}`);
  return Number(reserved);
}

/** Reserves the next timeline version atomically under the entity lock (F09). */
export async function reserveTimelineVersion(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
): Promise<number> {
  const rows = await tx
    .update(entityExecution)
    .set({
      nextTimelineVersion: sql`${entityExecution.nextTimelineVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)))
    .returning({ reserved: sql<number>`${entityExecution.nextTimelineVersion} - 1` });
  const reserved = rows[0]?.reserved;
  if (reserved === undefined) throw new Error(`cannot reserve timeline version for ${kind}:${entityId}`);
  return Number(reserved);
}

/** Reserves the next edit-window version atomically under the entity lock (F09). */
export async function reserveWindowVersion(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
): Promise<number> {
  const rows = await tx
    .update(entityExecution)
    .set({ nextWindowVersion: sql`${entityExecution.nextWindowVersion} + 1`, updatedAt: new Date() })
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)))
    .returning({ reserved: sql<number>`${entityExecution.nextWindowVersion} - 1` });
  const reserved = rows[0]?.reserved;
  if (reserved === undefined) throw new Error(`cannot reserve window version for ${kind}:${entityId}`);
  return Number(reserved);
}

/** Bumps the monotonic constraints revision bans read/publish against (F13). */
export async function bumpConstraintsRevision(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
): Promise<number> {
  const rows = await tx
    .update(entityExecution)
    .set({
      constraintsRevision: sql`${entityExecution.constraintsRevision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)))
    .returning({ revision: entityExecution.constraintsRevision });
  const revision = rows[0]?.revision;
  if (revision === undefined) throw new Error(`cannot bump constraints revision for ${kind}:${entityId}`);
  return revision;
}

/** Publishes a generation as the active one under the entity lock (F09/F11). */
export async function setActiveGeneration(
  tx: Executor,
  kind: EntityKind,
  entityId: string,
  generationId: string | null,
): Promise<void> {
  await tx
    .update(entityExecution)
    .set({ activeGenerationId: generationId, updatedAt: new Date() })
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)));
}

/**
 * True when the given generation is still the entity's active one. A terminal
 * failure from an old generation must not overwrite a newer generation's state
 * (F08/F09); callers check this before propagating entity status.
 */
export async function isGenerationActive(
  db: Executor,
  kind: EntityKind,
  entityId: string,
  generationId: string | null,
): Promise<boolean> {
  if (generationId === null) return true;
  const rows = await db
    .select({ active: entityExecution.activeGenerationId })
    .from(entityExecution)
    .where(and(eq(entityExecution.entityKind, kind), eq(entityExecution.entityId, entityId)));
  const active = rows[0]?.active;
  return active === undefined || active === null || active === generationId;
}

/** Completed logical step keys for a generation, for fan-in decisions (F10). */
export async function listCompletedStepKeys(
  db: Executor,
  entityId: string,
  generationId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ stepKey: jobs.stepKey })
    .from(jobs)
    .where(
      and(
        eq(jobs.entityId, entityId),
        eq(jobs.generationId, generationId),
        eq(jobs.status, 'COMPLETED'),
      ),
    );
  return new Set(rows.map((row) => row.stepKey).filter((key): key is string => key !== null));
}
