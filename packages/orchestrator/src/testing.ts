import type { Database, JobRow } from '@memetize/database';
import { type EnqueueArgs, enqueueJob } from '@memetize/job-system';
import type { AppConfig, Logger } from '@memetize/shared';
import type { Enqueue, JobContext } from './types';

export interface DirectJobContextArgs {
  job: JobRow;
  db: Database;
  config: AppConfig;
  logger: Logger;
  /** Defaults to a real enqueue on `db`. */
  enqueue?: Enqueue;
}

/**
 * A `JobContext` for calling a handler directly in tests, without an
 * Orchestrator: `publish` runs the handler's publication function against the
 * database with no lease or generation check (there is no claimed job to own),
 * so the handler's writes still happen in one transaction. Production code never
 * uses this — the Orchestrator builds the real context.
 */
export function createDirectJobContext(args: DirectJobContextArgs): JobContext {
  const enqueue: Enqueue =
    args.enqueue ?? ((enqueueArgs: EnqueueArgs) => enqueueJob(args.db, enqueueArgs));
  return {
    job: args.job,
    db: args.db,
    config: args.config,
    logger: args.logger,
    enqueue,
    publish: (fn) =>
      args.db.transaction((tx) =>
        fn({ tx, enqueue: (enqueueArgs) => enqueueJob(tx, enqueueArgs) }),
      ),
  };
}
