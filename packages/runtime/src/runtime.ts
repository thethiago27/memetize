import { createDatabase, type Database, type Executor, type JobRow } from '@memetize/database';
import { type EntityKind, isGenerationActive } from '@memetize/job-system';
import { getAsset, maybeEnqueueVisionAnalysis, setAssetStatus } from '@memetize/media-catalog';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import {
  getProject,
  maybeEnqueueNarrative,
  maybeEnqueueSubtitles,
  setProjectStatus,
} from '@memetize/projects';
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

export interface CreateOrchestratorOptions {
  db: Database;
  config: AppConfig;
  logger?: Logger;
  leaseMs?: number;
}

/**
 * Which coordination row guards a job's publication (F09), from the id scheme:
 * `prj_` projects and `ast_` assets. Anything else (PING, FEEDBACK_EMBED keyed by
 * a feedback event) has no entity lock or generation.
 */
export function entityKindOf(job: Pick<JobRow, 'entityId'>): EntityKind | null {
  if (job.entityId.startsWith('prj_')) return 'project';
  if (job.entityId.startsWith('ast_')) return 'asset';
  return null;
}

/**
 * The one way to build an Orchestrator with the app's domain wiring: the full
 * handler registry, entity-kind resolution, fan-in barriers evaluated inside the
 * completion transaction (F10), and failure propagation to the owning entity
 * (F08). CLI, API and end-to-end tests all go through here, so none of them can
 * end up with a runner that never fires the barriers.
 */
export function createOrchestrator(options: CreateOrchestratorOptions): Orchestrator {
  const { db, config } = options;
  return new Orchestrator({
    db,
    config,
    registry: buildRegistry(),
    scheduler: new ResourceScheduler(config.resources),
    logger: options.logger ?? createLogger(),
    leaseMs: options.leaseMs,
    entityKindOf,
    onJobFailed: (job) => propagateEntityFailure(db, job),
    onJobCompleted: (tx, job) => evaluateBarriers(tx, job),
  });
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
  const orchestrator = createOrchestrator({ db, config, logger });
  return { config, db, logger, orchestrator, close: owned.close };
}

/**
 * Evaluates the fan-in barriers inside a sibling job's completion transaction
 * (F10): completion state is committed in the same transaction as the
 * continuation it triggers, so the last sibling reliably enqueues the downstream
 * step exactly once and a crash cannot separate the two.
 */
export async function evaluateBarriers(tx: Executor, job: JobRow): Promise<void> {
  if (job.type === 'AUDIO_ANALYZE' || job.type === 'LYRICS') {
    await maybeEnqueueNarrative(tx, job.entityId, job.type, job.generationId);
  }
  if (job.type === 'LYRICS') {
    await maybeEnqueueSubtitles(tx, job.entityId, job.generationId);
  }
  if (job.type === 'FRAME_EXTRACT' || job.type === 'TRANSCRIPT') {
    await maybeEnqueueVisionAnalysis(tx, job.entityId, job.type, job.generationId);
  }
}

/**
 * Marks the owning project/asset FAILED when a job fails terminally (F08), so an
 * entity never sits forever in a mid-pipeline status. The failure is only
 * propagated when the job's generation is still the active one — a terminal
 * failure from a superseded generation must not mark a newer one FAILED (F09).
 */
export async function propagateEntityFailure(db: Database, job: JobRow): Promise<void> {
  const kind = entityKindOf(job);
  if (kind === 'project') {
    const project = await getProject(db, job.entityId);
    if (project && (await isGenerationActive(db, 'project', job.entityId, job.generationId))) {
      await setProjectStatus(db, job.entityId, 'FAILED');
    }
    return;
  }
  if (kind === 'asset') {
    const asset = await getAsset(db, job.entityId);
    if (asset && (await isGenerationActive(db, 'asset', job.entityId, job.generationId))) {
      await setAssetStatus(db, job.entityId, 'FAILED');
    }
  }
}
