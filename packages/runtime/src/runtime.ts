import { createDatabase, type Database, type JobRow } from '@memetize/database';
import { isGenerationActive } from '@memetize/job-system';
import { getAsset, maybeEnqueueVisionAnalysis, setAssetStatus } from '@memetize/media-catalog';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import { getProject, maybeEnqueueNarrative, setProjectStatus } from '@memetize/projects';
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
  const db = owned.db;
  const orchestrator = new Orchestrator({
    db,
    config,
    registry: buildRegistry(),
    scheduler: new ResourceScheduler(config.resources),
    logger,
    onJobFailed: (job) => propagateEntityFailure(db, job),
    onJobCompleted: (job) => evaluateBarriers(db, job),
  });
  return { config, db, logger, orchestrator, close: owned.close };
}

/**
 * Evaluates the fan-in barriers after a sibling job completes (F10). Runs from
 * the orchestrator's post-completion hook, so completion state is committed and
 * the last sibling reliably enqueues the downstream step exactly once.
 */
async function evaluateBarriers(db: Database, job: JobRow): Promise<void> {
  if (job.type === 'AUDIO_ANALYZE' || job.type === 'LYRICS') {
    await maybeEnqueueNarrative(db, job.entityId, job.type);
  } else if (job.type === 'FRAME_EXTRACT' || job.type === 'TRANSCRIPT') {
    await maybeEnqueueVisionAnalysis(db, job.entityId, job.type);
  }
}

/**
 * Marks the owning project/asset FAILED when a job fails terminally (F08), so an
 * entity never sits forever in a mid-pipeline status. The failure is only
 * propagated when the job's generation is still the active one — a terminal
 * failure from a superseded generation must not mark a newer one FAILED (F09).
 */
async function propagateEntityFailure(db: Database, job: JobRow): Promise<void> {
  const project = await getProject(db, job.entityId);
  if (project) {
    if (await isGenerationActive(db, 'project', job.entityId, job.generationId)) {
      await setProjectStatus(db, job.entityId, 'FAILED');
    }
    return;
  }
  const asset = await getAsset(db, job.entityId);
  if (asset) {
    if (await isGenerationActive(db, 'asset', job.entityId, job.generationId)) {
      await setAssetStatus(db, job.entityId, 'FAILED');
    }
  }
}
