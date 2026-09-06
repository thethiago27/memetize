import type { JobType } from '@memetize/contracts';
import type { Executor } from '@memetize/database';
import { type EnqueueResult, enqueueJob, stepKeyFor } from './enqueue';
import { type EntityKind, ensureEntityExecution, isStepSatisfied, lockEntity } from './entity';
import { listJobsForEntity } from './queries';

export interface FanInBarrierArgs {
  kind: EntityKind;
  entityId: string;
  /** The job type that just completed, and the sibling it must wait for. */
  completedType: JobType;
  siblingType: JobType;
  generationId: string | null;
  /** What to enqueue once both siblings are satisfied. */
  next: { type: JobType; input: Record<string, unknown> };
}

/**
 * The fan-in barrier: two independent steps must both finish before a third
 * starts (spec sections 12 and 24 — frames+transcript before vision, audio+lyrics
 * before narrative).
 *
 * Call it INSIDE the completing job's publication transaction (F10), after the
 * job is marked COMPLETED. It takes the entity lock, so two siblings finishing
 * together serialize and the second sees the first's completion, and the
 * continuation's enqueue commits with the completion that justified it — a crash
 * can never land between "both COMPLETED" and "continuation enqueued". The
 * enqueue is idempotent per (entity, generation, step).
 *
 * With a generation, the sibling counts as satisfied when it COMPLETED in this
 * generation or, when this generation never re-ran it (`reprocess --from lyrics`
 * keeps the previous audio analysis), when the entity's most recent job of that
 * type is COMPLETED. Legacy jobs without a generation fall back to the latter.
 */
export async function maybeEnqueueAfterFanIn(
  tx: Executor,
  args: FanInBarrierArgs,
): Promise<EnqueueResult | null> {
  await ensureEntityExecution(tx, args.kind, args.entityId);
  await lockEntity(tx, args.kind, args.entityId);

  const satisfied = args.generationId
    ? await isStepSatisfied(tx, {
        entityId: args.entityId,
        generationId: args.generationId,
        stepKey: stepKeyFor(args.siblingType),
        type: args.siblingType,
      })
    : await latestOfTypeCompleted(tx, args.entityId, args.siblingType);
  if (!satisfied) return null;

  return enqueueJob(tx, {
    type: args.next.type,
    entityId: args.entityId,
    input: args.next.input,
    generationId: args.generationId,
    stepKey: args.generationId ? stepKeyFor(args.next.type) : null,
  });
}

async function latestOfTypeCompleted(
  tx: Executor,
  entityId: string,
  type: JobType,
): Promise<boolean> {
  const jobs = await listJobsForEntity(tx, entityId);
  return jobs.filter((job) => job.type === type).at(-1)?.status === 'COMPLETED';
}
