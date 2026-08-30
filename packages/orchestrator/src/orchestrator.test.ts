import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { enqueueJob, JobFailure } from '@memetize/job-system';
import type { AppConfig } from '@memetize/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Orchestrator } from './orchestrator';
import { ResourceScheduler } from './scheduler';
import type { JobRegistry } from './types';

const handle = await createTestDatabase();
// Safe: the suite body only runs (dereferencing db) when a test DB is present.
const db = handle?.db as Database;

const config: AppConfig = {
  databaseUrl: 'unused-in-tests',
  testDatabaseUrl: null,
  rootDir: process.cwd(),
  storageDir: '/tmp',
  storageDirRelative: 'storage',
  resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
};

describe.skipIf(!handle)('Orchestrator (integration)', () => {
  const scheduler = new ResourceScheduler(config.resources);

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('runs a handler and stores its result', async () => {
    const registry: JobRegistry = { PING: async () => ({ pong: true }) };
    const orchestrator = new Orchestrator({ db, config, registry, scheduler });
    await enqueueJob(db, { type: 'PING', entityId: 'e1', input: {} });

    const outcome = await orchestrator.runOnce();

    expect(outcome?.status).toBe('COMPLETED');
    expect(outcome?.result).toEqual({ pong: true });
  });

  it('marks the job FAILED when the handler throws JobFailure', async () => {
    const registry: JobRegistry = {
      PING: async () => {
        throw new JobFailure('BOOM', 'nope', false);
      },
    };
    const orchestrator = new Orchestrator({ db, config, registry, scheduler });
    await enqueueJob(db, { type: 'PING', entityId: 'e2', input: {} });

    const outcome = await orchestrator.runOnce();

    expect(outcome?.status).toBe('FAILED');
    expect(outcome?.error?.code).toBe('BOOM');
  });

  it('drains follow-up jobs enqueued by handlers', async () => {
    const registry: JobRegistry = {
      VIDEO_NORMALIZE: async (ctx) => {
        await ctx.enqueue({
          type: 'SCENE_DETECT',
          entityId: ctx.job.entityId,
          input: { assetId: ctx.job.entityId, analysisPath: 'analysis.mp4' },
        });
        return { chained: true };
      },
      SCENE_DETECT: async () => ({ sceneCount: 0 }),
    };
    const orchestrator = new Orchestrator({ db, config, registry, scheduler });
    await enqueueJob(db, {
      type: 'VIDEO_NORMALIZE',
      entityId: 'ast_1',
      input: { assetId: 'ast_1', originalPath: 'original.mp4' },
    });

    const outcomes = await orchestrator.drain({ entityId: 'ast_1' });

    expect(outcomes.map((outcome) => outcome.job.type)).toEqual([
      'VIDEO_NORMALIZE',
      'SCENE_DETECT',
    ]);
    expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
  });
});
