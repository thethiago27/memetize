import { createTestDatabase, type Database, jobs, projects, truncateAll } from '@memetize/database';
import {
  claimNextJob,
  enqueueJob,
  ensureEntityExecution,
  JobFailure,
  startGeneration,
} from '@memetize/job-system';
import type { AppConfig } from '@memetize/shared';
import { eq, sql } from 'drizzle-orm';
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
  embeddingDimensions: 384,
  providerMode: 'demo',
  providers: {
    transcription: { kind: 'fixture', model: null },
    vision: { kind: 'fixture', model: null },
    llm: { kind: 'fixture', model: null },
    embedding: { kind: 'fixture', model: null },
    audio: { kind: 'fixture', model: null },
  },
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

  it('publishes nothing when the attempt lost its lease before publishing (F08)', async () => {
    const registry: JobRegistry = {
      PING: async (ctx) => {
        // Simulate a lease that expired mid-run and was reclaimed by another worker.
        await db
          .update(jobs)
          .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
          .where(eq(jobs.id, ctx.job.id));
        await claimNextJob(db, { entityId: ctx.job.entityId });
        return ctx.publish(async ({ tx }) => {
          await tx.insert(projects).values({ id: 'prj_leaked', filename: 'x', status: 'CREATED' });
          return { leaked: true };
        });
      },
    };
    const orchestrator = new Orchestrator({ db, config, registry, scheduler });
    await enqueueJob(db, { type: 'PING', entityId: 'e_lease', input: {} });

    const outcome = await orchestrator.runOnce();

    expect(outcome?.status).toBe('FAILED');
    expect(outcome?.error?.code).toBe('LEASE_LOST');
    // The domain write rolled back with the refused publication.
    expect(await db.query.projects.findMany()).toHaveLength(0);
    // The job still belongs to the new owner (RUNNING), untouched by the stale attempt.
    const row = await db.query.jobs.findFirst({ where: eq(jobs.entityId, 'e_lease') });
    expect(row?.status).toBe('RUNNING');
    expect(row?.attempts).toBe(2);
  });

  it('cancels the attempt instead of publishing when its generation was superseded (F09)', async () => {
    const projectId = 'prj_superseded';
    await db.insert(projects).values({ id: projectId, filename: 'x', status: 'PLANNING' });
    await ensureEntityExecution(db, 'project', projectId);
    const generationId = await startGeneration(db, 'project', projectId);
    const registry: JobRegistry = {
      PING: async (ctx) => {
        // A reprocess lands while this attempt is running.
        await startGeneration(db, 'project', projectId);
        return ctx.publish(async ({ tx }) => {
          await tx.update(projects).set({ status: 'COMPLETED' }).where(eq(projects.id, projectId));
          return { published: true };
        });
      },
    };
    const orchestrator = new Orchestrator({
      db,
      config,
      registry,
      scheduler,
      entityKindOf: () => 'project',
    });
    await enqueueJob(db, { type: 'PING', entityId: projectId, input: {}, generationId });

    const outcome = await orchestrator.runOnce();

    expect(outcome?.status).toBe('CANCELLED');
    expect(outcome?.error?.code).toBe('GENERATION_SUPERSEDED');
    const row = await db.query.jobs.findFirst({ where: eq(jobs.entityId, projectId) });
    expect(row?.status).toBe('CANCELLED');
    expect((await db.query.projects.findFirst({ where: eq(projects.id, projectId) }))?.status).toBe(
      'PLANNING',
    );
  });

  it('commits the continuation with the completion, or neither (F10)', async () => {
    let failHook = true;
    const registry: JobRegistry = {
      PING: async (ctx) =>
        ctx.publish(async ({ tx }) => {
          await tx.insert(projects).values({ id: 'prj_cont', filename: 'x', status: 'CREATED' });
          return { ok: true };
        }),
    };
    const orchestrator = new Orchestrator({
      db,
      config,
      registry,
      scheduler,
      onJobCompleted: async (tx, job) => {
        if (failHook) throw new Error('continuation store unavailable');
        await enqueueJob(tx, { type: 'PING', entityId: `${job.entityId}_next`, input: {} });
      },
    });
    await enqueueJob(db, { type: 'PING', entityId: 'e_cont', input: {} });

    // First attempt: the continuation fails, so the completion and the domain
    // write roll back together and the job goes back to PENDING for a retry.
    const first = await orchestrator.runOnce({ entityId: 'e_cont' });
    expect(first?.status).toBe('FAILED');
    expect(first?.error?.code).toBe('PUBLISH_FAILED');
    expect(await db.query.projects.findMany()).toHaveLength(0);
    let row = await db.query.jobs.findFirst({ where: eq(jobs.entityId, 'e_cont') });
    expect(row?.status).toBe('PENDING');

    // Second attempt: completion, domain write and continuation land together.
    failHook = false;
    const second = await orchestrator.runOnce({ entityId: 'e_cont' });
    expect(second?.status).toBe('COMPLETED');
    row = await db.query.jobs.findFirst({ where: eq(jobs.entityId, 'e_cont') });
    expect(row?.status).toBe('COMPLETED');
    expect(await db.query.projects.findMany()).toHaveLength(1);
    expect(
      await db.query.jobs.findFirst({ where: eq(jobs.entityId, 'e_cont_next') }),
    ).toBeDefined();
  });

  it('resumes a job abandoned by a crashed worker on the maintenance tick (F08)', async () => {
    const registry: JobRegistry = { PING: async () => ({ resumed: true }) };
    const orchestrator = new Orchestrator({ db, config, registry, scheduler });
    const { job } = await enqueueJob(db, { type: 'PING', entityId: 'e_resume', input: {} });
    // A worker claimed it and died; its lease has expired.
    await claimNextJob(db, { entityId: 'e_resume', leaseMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const tick = await orchestrator.maintenanceTick();

    expect(tick.ran).toBe(1);
    const row = await db.query.jobs.findFirst({ where: eq(jobs.id, job.id) });
    expect(row?.status).toBe('COMPLETED');
    expect(row?.attempts).toBe(2);
  });
});
