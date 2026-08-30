import type { JobType } from '@memetize/contracts';
import type { Database, JobRow } from '@memetize/database';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  getJob,
  JobFailure,
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

  constructor(private readonly options: OrchestratorOptions) {
    this.logger = options.logger ?? createLogger();
  }

  private registeredTypes(): JobType[] {
    return Object.keys(this.options.registry) as JobType[];
  }

  /** Claims and runs a single job. Returns null when nothing is claimable. */
  async runOnce(args: { entityId?: string } = {}): Promise<RunOutcome | null> {
    const { db, config, registry, scheduler } = this.options;
    const types = this.registeredTypes();
    if (types.length === 0) return null;

    const job = await claimNextJob(db, { entityId: args.entityId, types });
    if (!job) return null;

    const logger = this.logger.child({
      jobId: job.id,
      worker: job.type,
      workerVersion: job.workerVersion,
      entityId: job.entityId,
    });

    const handler = registry[job.type];
    if (!handler) {
      const message = `no handler registered for job type ${job.type}`;
      logger.error('job_no_handler', { message });
      const failed = await failJob(db, job.id, {
        code: 'NO_HANDLER',
        message,
        retryable: false,
      });
      return { job: failed ?? job, status: 'FAILED', error: { code: 'NO_HANDLER', message } };
    }

    return scheduler.withSlot(job.resourceClass, async () => {
      const startedAt = Date.now();
      logger.info('job_started');
      try {
        const result = await handler({
          job,
          db,
          config,
          logger,
          enqueue: (enqueueArgs) => enqueueJob(db, enqueueArgs),
        });
        const done = await completeJob(db, job.id, result);
        logger.info('job_completed', { processingTimeMs: Date.now() - startedAt });
        return { job: done ?? job, status: 'COMPLETED', result };
      } catch (error) {
        const code = error instanceof JobFailure ? error.code : 'UNHANDLED_ERROR';
        const retryable = error instanceof JobFailure ? error.retryable : false;
        const message = error instanceof Error ? error.message : String(error);
        logger.error('job_failed', { code, message, retryable });
        const failed = await failJob(db, job.id, { code, message, retryable });
        return { job: failed ?? job, status: 'FAILED', error: { code, message } };
      }
    });
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

  getJob(id: string): Promise<JobRow | undefined> {
    return getJob(this.options.db, id);
  }
}
