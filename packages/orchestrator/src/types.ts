import type { JobType } from '@memetize/contracts';
import type { Database, Executor, JobRow } from '@memetize/database';
import type { EnqueueArgs, EnqueueResult } from '@memetize/job-system';
import type { AppConfig, Logger } from '@memetize/shared';

/** Enqueue bound to a transaction; stamps the current job's generation when the caller gives none. */
export type Enqueue = (args: EnqueueArgs) => Promise<EnqueueResult>;

/** What a handler's publication step receives: the transaction and an enqueue bound to it. */
export interface PublishContext {
  tx: Executor;
  enqueue: Enqueue;
}

/** Everything a handler needs to do its work and chain follow-up jobs. */
export interface JobContext {
  job: JobRow;
  db: Database;
  config: AppConfig;
  logger: Logger;
  /**
   * Enqueue outside a publication. Prefer `publish` for the follow-up steps a
   * result implies, so they commit together with it.
   */
  enqueue: Enqueue;
  /**
   * Publishes the handler's result atomically (F08/F09/F10). Inside one
   * transaction it locks the owning entity, verifies this attempt still holds the
   * job's lease and that the job's generation is still the active one, runs `fn`
   * (domain writes and follow-up enqueues on the same transaction), marks the job
   * COMPLETED with `fn`'s return value as its result, and evaluates the fan-in
   * continuations — all commit or roll back together. A lost lease or a superseded
   * generation throws before anything is written, and the handler must let that
   * error propagate. After `publish` the handler returns the same result and
   * performs no further database writes (debug files are fine).
   */
  publish: (
    fn: (ctx: PublishContext) => Promise<Record<string, unknown>>,
  ) => Promise<Record<string, unknown>>;
}

/**
 * A job handler transforms a claimed job into a result object (stored on the
 * job). It performs its own side effects (persisting domain data, enqueuing
 * follow-ups) — ideally through `ctx.publish` — and throws `JobFailure` to
 * signal a structured failure.
 */
export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

export type JobRegistry = Partial<Record<JobType, JobHandler>>;
