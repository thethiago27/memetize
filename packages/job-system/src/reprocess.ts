import type { JobType } from '@memetize/contracts';
import type { Executor } from '@memetize/database';
import { type EnqueueResult, enqueueJob, stepKeyFor } from './enqueue';
import { type EntityKind, ensureEntityExecution, lockEntity, startGeneration } from './entity';
import { cancelActiveJobsForEntity, countRunningForEntity } from './queries';

export interface StartReprocessArgs {
  kind: EntityKind;
  entityId: string;
  /** The stage's own job plus everything downstream of it. */
  supersededTypes: JobType[];
  /** Types that make the command refuse while RUNNING; defaults to `supersededTypes`. */
  busyTypes?: JobType[];
  /** The domain's own busy error, so callers keep their `PROJECT_BUSY`/`ASSET_BUSY` codes. */
  busyError: (entityId: string) => Error;
}

export interface ReprocessHandle {
  /** The new active generation every job enqueued through `enqueue` belongs to. */
  generationId: string;
  /** Jobs of the superseded stages that were PENDING and are now CANCELLED. */
  cancelled: number;
  /** Enqueues into this generation, stamped with the step key. */
  enqueue: (type: JobType, input: Record<string, unknown>) => Promise<EnqueueResult>;
}

/**
 * The opening move every `reprocess --from <stage>` makes, whatever the entity
 * (spec section 42): take the entity lock, refuse if a superseded stage is
 * RUNNING, cancel the PENDING ones, and start a new generation.
 *
 * Call it inside the caller's transaction; the caller then enqueues its own
 * stage's first job through the returned `enqueue`. Jobs are never deleted —
 * COMPLETED ones stay as history — and because the generation id is part of the
 * idempotency key a fresh job is created even when a previous generation already
 * COMPLETED the same step.
 *
 * The project and asset commands each carried their own copy of this preamble,
 * so a change to what "reprocess" means had to be made in both.
 */
export async function startReprocess(
  tx: Executor,
  args: StartReprocessArgs,
): Promise<ReprocessHandle> {
  await ensureEntityExecution(tx, args.kind, args.entityId);
  await lockEntity(tx, args.kind, args.entityId);

  const busyTypes = args.busyTypes ?? args.supersededTypes;
  if ((await countRunningForEntity(tx, args.entityId, busyTypes)) > 0) {
    throw args.busyError(args.entityId);
  }

  const cancelled = await cancelActiveJobsForEntity(tx, args.entityId, args.supersededTypes, [
    'PENDING',
  ]);
  const generationId = await startGeneration(tx, args.kind, args.entityId);

  return {
    generationId,
    cancelled: cancelled.length,
    enqueue: (type, input) =>
      enqueueJob(tx, {
        type,
        entityId: args.entityId,
        input,
        generationId,
        stepKey: stepKeyFor(type),
      }),
  };
}
