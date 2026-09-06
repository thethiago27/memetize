import type { JobType } from '@memetize/contracts';
import type { Database, Executor, JobRow } from '@memetize/database';
import {
  assertJobOwned,
  cancelOwnedJob,
  claimNextJob,
  completeJob,
  DEFAULT_LEASE_MS,
  type EnqueueArgs,
  type EntityKind,
  enqueueJob,
  ensureEntityExecution,
  failJob,
  GenerationSupersededError,
  getJob,
  JobFailure,
  LeaseLostError,
  lockEntity,
  reconcileExpiredLeases,
  renewLease,
  requireActiveGeneration,
} from '@memetize/job-system';
import { type AppConfig, createLogger, type Logger } from '@memetize/shared';
import type { ResourceScheduler } from './scheduler';
import type { JobRegistry, PublishContext } from './types';

export interface OrchestratorOptions {
  db: Database;
  config: AppConfig;
  registry: JobRegistry;
  scheduler: ResourceScheduler;
  logger?: Logger;
  /** Lease duration for claimed jobs; renewed on a heartbeat while running. */
  leaseMs?: number;
  /**
   * Maps a job to the kind of entity whose coordination row guards its
   * publication (F09). Returning null skips the entity lock and the generation
   * check (jobs outside an entity pipeline, e.g. PING); ownership is still
   * verified. The orchestrator stays domain-free; the wiring knows the id scheme.
   */
  entityKindOf?: (job: JobRow) => EntityKind | null;
  /**
   * Called after a job is marked FAILED so the app can propagate the failure to
   * the owning project/asset status (F08).
   */
  onJobFailed?: (job: JobRow, error: { code: string; message: string }) => Promise<void>;
  /**
   * Called inside the completion transaction, after the job is marked COMPLETED
   * and before commit, so fan-in continuations are decided against committed
   * completion state and enqueued atomically with it (F10): a crash between
   * "completed" and "next step enqueued" cannot happen because they are one write.
   */
  onJobCompleted?: (tx: Executor, job: JobRow) => Promise<void>;
}

export interface RunOutcome {
  job: JobRow;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

/**
 * Generic local job runner: claims a job, acquires its resource slot, runs the
 * registered handler, then publishes success/failure under the job's lease and
 * the entity's coordination lock. It contains no domain-specific logic;
 * handlers own that (spec section 6/79).
 */
export class Orchestrator {
  private readonly logger: Logger;
  private stopping = false;
  private readonly inflight = new Set<Promise<RunOutcome>>();
  private maintenanceTimer: NodeJS.Timeout | null = null;
  private maintenanceRunning = false;

  constructor(private readonly options: OrchestratorOptions) {
    this.logger = options.logger ?? createLogger();
  }

  /**
   * Stops new claims and waits for in-flight jobs to finish, up to `timeoutMs`
   * (F08). Called during process shutdown so a running job commits or fails
   * cleanly (its lease still guards the write) instead of being cut off.
   */
  async shutdown(timeoutMs = 30_000): Promise<void> {
    this.stopping = true;
    this.stopMaintenance();
    if (this.inflight.size === 0) return;
    this.logger.info('orchestrator_draining', { inflight: this.inflight.size });
    await Promise.race([
      Promise.allSettled([...this.inflight]),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  }

  /**
   * Periodic recovery and consumption (F08): every `intervalMs` the orchestrator
   * finalizes abandoned jobs and drains whatever is runnable — including RUNNING
   * jobs whose lease expired — so a crashed attempt is resumed without waiting for
   * a new HTTP request or a manual `worker run`. Ticks never overlap.
   */
  startMaintenance(intervalMs = 30_000): void {
    if (this.maintenanceTimer) return;
    this.maintenanceTimer = setInterval(() => void this.maintenanceTick(), intervalMs);
    if (typeof this.maintenanceTimer.unref === 'function') this.maintenanceTimer.unref();
  }

  stopMaintenance(): void {
    if (!this.maintenanceTimer) return;
    clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }

  /** One recovery pass: reconcile, then drain everything runnable. Safe to call directly. */
  async maintenanceTick(): Promise<{ reconciled: number; ran: number }> {
    if (this.stopping || this.maintenanceRunning) return { reconciled: 0, ran: 0 };
    this.maintenanceRunning = true;
    try {
      const reconciled = await this.reconcile();
      const outcomes = await this.drain();
      return { reconciled, ran: outcomes.length };
    } catch (error) {
      this.logger.error('maintenance_tick_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return { reconciled: 0, ran: 0 };
    } finally {
      this.maintenanceRunning = false;
    }
  }

  private registeredTypes(): JobType[] {
    return Object.keys(this.options.registry) as JobType[];
  }

  /** Enqueue that inherits the running job's generation for same-entity follow-ups. */
  private stampGeneration(job: JobRow, args: EnqueueArgs): EnqueueArgs {
    if (args.generationId !== undefined || args.entityId !== job.entityId) return args;
    return { ...args, generationId: job.generationId };
  }

  /**
   * The single publication path (F08/F09/F10): lock the entity, prove ownership,
   * prove the generation is still current, apply the handler's writes, mark the
   * job COMPLETED and evaluate continuations — one transaction. Throws
   * `LeaseLostError` / `GenerationSupersededError` before any write when the
   * attempt may no longer publish.
   */
  private async publishCompletion(
    job: JobRow,
    leaseToken: string,
    fn: (ctx: PublishContext) => Promise<Record<string, unknown>>,
  ): Promise<JobRow> {
    const { db } = this.options;
    return db.transaction(async (tx) => {
      const kind = this.options.entityKindOf?.(job) ?? null;
      if (kind) {
        await ensureEntityExecution(tx, kind, job.entityId);
        await lockEntity(tx, kind, job.entityId);
      }
      await assertJobOwned(tx, job.id, leaseToken);
      if (kind) await requireActiveGeneration(tx, kind, job.entityId, job.generationId);

      const result = await fn({
        tx,
        enqueue: (args) => enqueueJob(tx, this.stampGeneration(job, args)),
      });
      const done = await completeJob(tx, job.id, result, leaseToken);
      if (!done) throw new LeaseLostError(job.id);
      if (this.options.onJobCompleted) await this.options.onJobCompleted(tx, done);
      return done;
    });
  }

  /**
   * Mid-pipeline status write (F09): takes the entity lock, checks the job's
   * generation is still the active one and that this attempt still owns the
   * lease, then applies `fn`. A superseded generation or a lost lease writes
   * nothing and returns false, so a stale attempt can never move a newer
   * generation's entity into one of its own progress states.
   */
  private async markProgress(
    job: JobRow,
    leaseToken: string,
    fn: (ctx: PublishContext) => Promise<void>,
  ): Promise<boolean> {
    const { db } = this.options;
    try {
      return await db.transaction(async (tx) => {
        const kind = this.options.entityKindOf?.(job) ?? null;
        if (kind) {
          await ensureEntityExecution(tx, kind, job.entityId);
          await lockEntity(tx, kind, job.entityId);
        }
        await assertJobOwned(tx, job.id, leaseToken);
        if (kind) await requireActiveGeneration(tx, kind, job.entityId, job.generationId);
        await fn({
          tx,
          enqueue: (args) => enqueueJob(tx, this.stampGeneration(job, args)),
        });
        return true;
      });
    } catch (error) {
      if (error instanceof LeaseLostError || error instanceof GenerationSupersededError) {
        return false;
      }
      throw error;
    }
  }

  /** Claims and runs a single job. Returns null when nothing is claimable. */
  async runOnce(args: { entityId?: string } = {}): Promise<RunOutcome | null> {
    const { db, config, registry, scheduler } = this.options;
    const leaseMs = this.options.leaseMs ?? DEFAULT_LEASE_MS;
    const types = this.registeredTypes();
    if (types.length === 0 || this.stopping) return null;

    const claimed = await claimNextJob(db, { entityId: args.entityId, types, leaseMs });
    if (!claimed) return null;
    const { job, leaseToken } = claimed;

    const logger = this.logger.child({
      jobId: job.id,
      worker: job.type,
      workerVersion: job.workerVersion,
      entityId: job.entityId,
      generationId: job.generationId ?? undefined,
      attempt: job.attempts,
    });

    const fail = async (code: string, message: string, retryable: boolean): Promise<RunOutcome> => {
      const failed = await failJob(db, job.id, { code, message, retryable }, leaseToken);
      const outcome: RunOutcome = {
        job: failed ?? job,
        status: 'FAILED',
        error: { code, message },
      };
      // Only propagate to the entity when this attempt actually recorded the
      // failure (still held the lease) and reached a terminal FAILED state.
      if (failed?.status === 'FAILED' && this.options.onJobFailed) {
        try {
          await this.options.onJobFailed(failed, { code, message });
        } catch (hookError) {
          logger.error('job_failed_hook_error', {
            message: hookError instanceof Error ? hookError.message : String(hookError),
          });
        }
      }
      return outcome;
    };

    const handler = registry[job.type];
    if (!handler) {
      const message = `no handler registered for job type ${job.type}`;
      logger.error('job_no_handler', { message });
      return fail('NO_HANDLER', message, false);
    }

    const exec = scheduler.withSlot(job.resourceClass, async (): Promise<RunOutcome> => {
      const startedAt = Date.now();
      logger.info('job_started');
      // Heartbeat: renew the lease well before it expires so a long FFmpeg/Python
      // step keeps ownership; losing it means another worker reclaimed the job.
      // The publication path re-checks ownership in the database regardless.
      const heartbeat = setInterval(
        () => {
          void renewLease(db, job.id, leaseToken, leaseMs).then((held) => {
            if (!held) logger.warn('job_lease_lost');
          });
        },
        Math.max(5_000, Math.floor(leaseMs / 4)),
      );
      if (typeof heartbeat.unref === 'function') heartbeat.unref();

      // Holder (not a bare `let`) so the closure's assignment is visible to the
      // control-flow analysis below.
      const state: { published: JobRow | null; publishFailure: unknown } = {
        published: null,
        publishFailure: null,
      };
      const publishOnce = async (
        fn: (ctx: PublishContext) => Promise<Record<string, unknown>>,
      ): Promise<JobRow> => {
        if (state.published) throw new Error(`job ${job.id}: publish() called more than once`);
        try {
          state.published = await this.publishCompletion(job, leaseToken, fn);
          return state.published;
        } catch (error) {
          state.publishFailure = error;
          throw error;
        }
      };
      const publish = async (
        fn: (ctx: PublishContext) => Promise<Record<string, unknown>>,
      ): Promise<Record<string, unknown>> => (await publishOnce(fn)).result ?? {};

      try {
        const result = await handler({
          job,
          db,
          config,
          logger,
          enqueue: (enqueueArgs) => enqueueJob(db, this.stampGeneration(job, enqueueArgs)),
          publish,
          progress: (fn) => this.markProgress(job, leaseToken, fn),
        });
        // Handlers that did not publish themselves are completed here, under the
        // same lock/ownership/generation checks and with the same continuations.
        const done: JobRow = state.published ?? (await publishOnce(async () => result));
        logger.info('job_completed', { processingTimeMs: Date.now() - startedAt });
        return { job: done, status: 'COMPLETED', result: done.result ?? result };
      } catch (error) {
        if (error instanceof LeaseLostError) {
          // Another worker owns the job now: nothing was published (F08).
          logger.warn('job_lease_lost_on_publish', { message: error.message });
          return { job, status: 'FAILED', error: { code: error.code, message: error.message } };
        }
        if (error instanceof GenerationSupersededError) {
          // A newer generation replaced this one while it ran: end the attempt
          // as CANCELLED, keep its history, publish nothing (F09).
          logger.warn('job_generation_superseded', { message: error.message });
          const cancelled = await cancelOwnedJob(db, job.id, leaseToken, error.message);
          return {
            job: cancelled ?? job,
            status: 'CANCELLED',
            error: { code: error.code, message: error.message },
          };
        }
        if (state.published) {
          // The result is durable; only post-publication work (debug files) failed.
          logger.warn('job_post_publish_error', {
            message: error instanceof Error ? error.message : String(error),
          });
          return {
            job: state.published,
            status: 'COMPLETED',
            result: state.published.result ?? {},
          };
        }
        // An error raised while publishing (a database failure, a continuation
        // that threw) rolled the whole publication back: nothing is half-written,
        // so the attempt is retried rather than terminally failed.
        const publishError = state.publishFailure === error && !(error instanceof JobFailure);
        const code =
          error instanceof JobFailure
            ? error.code
            : publishError
              ? 'PUBLISH_FAILED'
              : 'UNHANDLED_ERROR';
        const retryable = error instanceof JobFailure ? error.retryable : publishError;
        const message = error instanceof Error ? error.message : String(error);
        logger.error('job_failed', { code, message, retryable });
        return fail(code, message, retryable);
      } finally {
        clearInterval(heartbeat);
      }
    });

    this.inflight.add(exec);
    try {
      return await exec;
    } finally {
      this.inflight.delete(exec);
    }
  }

  /**
   * Runs jobs until none remain (optionally scoped to one entity), which is how
   * `asset add --wait` follows a pipeline through normalize -> scene detect.
   */
  async drain(args: { entityId?: string; maxJobs?: number } = {}): Promise<RunOutcome[]> {
    const outcomes: RunOutcome[] = [];
    const max = args.maxJobs ?? 1000;
    for (let i = 0; i < max; i += 1) {
      const outcome = await this.runOnce({ entityId: args.entityId });
      if (!outcome) break;
      outcomes.push(outcome);
    }
    return outcomes;
  }

  /**
   * Finalizes jobs abandoned by a crashed worker: any RUNNING job whose lease
   * expired with no attempts left becomes terminal FAILED (F08). Run at startup
   * and periodically (`startMaintenance`). Entity status is propagated for each so
   * a project/asset does not sit forever in a mid-pipeline state after a crash.
   * Abandoned jobs with attempts left are left for the claim path, which the
   * maintenance drain exercises right after.
   */
  async reconcile(): Promise<number> {
    const { db } = this.options;
    const finalized = await reconcileExpiredLeases(db);
    for (const job of finalized) {
      this.logger.warn('job_reconciled', {
        jobId: job.id,
        worker: job.type,
        entityId: job.entityId,
      });
      if (this.options.onJobFailed) {
        const full = await getJob(db, job.id);
        if (full) {
          try {
            await this.options.onJobFailed(full, {
              code: 'LEASE_EXPIRED',
              message: 'worker lease expired and attempts were exhausted',
            });
          } catch (error) {
            this.logger.error('job_reconcile_hook_error', {
              jobId: job.id,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
    return finalized.length;
  }

  getJob(id: string): Promise<JobRow | undefined> {
    return getJob(this.options.db, id);
  }
}
