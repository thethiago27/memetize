import { createDatabase, type Database } from '@memetize/database';
import { type JobRegistry, Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import { type AppConfig, createLogger, type Logger, loadConfig } from '@memetize/shared';
import { buildRegistry } from './registry';

export interface CliContext {
  config: AppConfig;
  db: Database;
  logger: Logger;
  orchestrator: Orchestrator;
  close: () => Promise<void>;
}

/** Builds the shared runtime (config, DB, orchestrator) for a CLI invocation. */
export async function buildContext(): Promise<CliContext> {
  const config = loadConfig();
  const { db, close } = createDatabase(config.databaseUrl);
  const logger = createLogger();
  const scheduler = new ResourceScheduler(config.resources);
  const registry: JobRegistry = buildRegistry();
  const orchestrator = new Orchestrator({ db, config, registry, scheduler, logger });
  return { config, db, logger, orchestrator, close };
}
