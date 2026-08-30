import type { JobType } from '@memetize/contracts';
import type { Database, JobRow } from '@memetize/database';
import type { EnqueueArgs, EnqueueResult } from '@memetize/job-system';
import type { AppConfig, Logger } from '@memetize/shared';

/** Everything a handler needs to do its work and chain follow-up jobs. */
export interface JobContext {
  job: JobRow;
  db: Database;
  config: AppConfig;
  logger: Logger;
  enqueue: (args: EnqueueArgs) => Promise<EnqueueResult>;
}

/**
 * A job handler transforms a claimed job into a result object (stored on the
 * job). It performs its own side effects (persisting domain data, enqueuing
 * follow-ups) and throws `JobFailure` to signal a structured failure.
 */
export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

export type JobRegistry = Partial<Record<JobType, JobHandler>>;
