import { createDatabase, type Database } from '@memetize/database';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import { type AppConfig, createLogger, type Logger, loadConfig } from '@memetize/shared';
import { buildRegistry } from './registry';

export interface AppRuntime {
  config: AppConfig;
  db: Database;
  logger: Logger;
  orchestrator: Orchestrator;
  close: () => Promise<void>;
}

export interface CreateAppRuntimeOptions {
  config?: AppConfig;
  db?: Database;
  close?: () => Promise<void>;
}

/**
 * Shared process wiring for the CLI and the Fastify API (spec section 6):
 * one config, one DB pool, one Orchestrator, the same job registry.
 */
export function createAppRuntime(options: CreateAppRuntimeOptions = {}): AppRuntime {
  const config = options.config ?? loadConfig();
  const owned = options.db
    ? { db: options.db, close: options.close ?? (async () => undefined) }
    : createDatabase(config.databaseUrl);
  const logger = createLogger();
  const orchestrator = new Orchestrator({
    db: owned.db,
    config,
    registry: buildRegistry(),
    scheduler: new ResourceScheduler(config.resources),
    logger,
  });
  return { config, db: owned.db, logger, orchestrator, close: owned.close };
}
