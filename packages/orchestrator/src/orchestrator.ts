import type { JobType } from '@memetize/contracts';
import type { Database, JobRow } from '@memetize/database';
import {
  claimNextJob,
  completeJob,
  DEFAULT_LEASE_MS,
  enqueueJob,
  failJob,
  getJob,
  JobFailure,
  reconcileExpiredLeases,
  renewLease,
} from '@memetize/job-system';
import { type AppConfig, createLogger, type Logger } from '@memetize/shared';
import type { ResourceScheduler } from './scheduler';
import type { JobRegistry } from './types';

export interface OrchestratorOptions {
  db: Database;
  config: AppConfig;
  registry: JobRegistry;
  scheduler: ResourceScheduler;
  logger?: Logger;
  /** Lease duration for claimed jobs; renewed on a heartbeat while running. */
  leaseMs?: number;
  /**
   * Called after a job is marked FAILED so the app can propagate the failure to
   * the owning project/asset status (F08). The orchestrator stays domain-free;
   * the wiring maps the job's entity to the right status update.
   */
  onJobFailed?: (job: JobRow, error: { code: string; message: string }) => Promise<void>;
  /**
   * Called after a job is durably marked COMPLETED, so the app can evaluate
   * fan-in barriers against committed completion state (F10). Running this after
   * completion — not inside the handler — is what makes the barrier race-free.
   */
  onJobCompleted?: (job: JobRow) => Promise<void>;
}

export interface RunOutcome {
  job: JobRow;
  status: 'COMPLETED' | 'FAILED';
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

/**
 * Generic local job runner: claims a job, acquires its resource slot, runs the
 * registered handler, then persists success/failure. It contains no
 * domain-specific logic; handlers own that (spec section 6/79).
 */
export class Orchestrator {
  private readonly logger: Logger;
  private stopping = false;
  private readonly inflight = new Set<Promise<RunOutcome>>();

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

  private registeredTypes(): JobType[] {
    return Object.keys(this.options.registry) as JobType[];
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
      const heartbeat = setInterval(
        () => {
          void renewLease(db, job.id, leaseToken, leaseMs).then((held) => {
            if (!held) logger.warn('job_lease_lost');
          });
        },
        Math.max(5_000, Math.floor(leaseMs / 4)),
      );
      if (typeof heartbeat.unref === 'function') heartbeat.unref();

      try {
        const result = await handler({
          job,
          db,
          config,
          logger,
          enqueue: (enqueueArgs) => enqueueJob(db, enqueueArgs),
        });
        const done = await completeJob(db, job.id, result, leaseToken);
        if (!done) {
          // Lost the lease before we could commit success: another worker owns
          // the job now, so this attempt must not report completion (F08).
          const message = 'lease lost before completion; result discarded';
          logger.warn('job_lease_lost_on_complete', { message });
          return { job, status: 'FAILED', error: { code: 'LEASE_LOST', message } };
        }
        logger.info('job_completed', { processingTimeMs: Date.now() - startedAt });
        // Evaluate fan-in barriers against committed completion state (F10).
        if (this.options.onJobCompleted) {
          try {
            await this.options.onJobCompleted(done);
          } catch (hookError) {
            logger.error('job_completed_hook_error', {
              message: hookError instanceof Error ? hookError.message : String(hookError),
            });
          }
        }
        return { job: done, status: 'COMPLETED', result };
      } catch (error) {
        const code = error instanceof JobFailure ? error.code : 'UNHANDLED_ERROR';
        const retryable = error instanceof JobFailure ? error.retryable : false;
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
   * and periodically. Entity status is propagated for each so a project/asset
   * does not sit forever in a mid-pipeline state after a crash.
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
