import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { claimNextJob } from './claim';
import { completeJob, failJob } from './complete';
import { enqueueJob } from './enqueue';

const handle = await createTestDatabase();
// Safe: the suite body only runs (dereferencing db) when a test DB is present.
const db = handle?.db as Database;

describe.skipIf(!handle)('job-system (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('enqueue is idempotent on the logical key', async () => {
    const a = await enqueueJob(db, { type: 'PING', entityId: 'demo', input: { x: 1 } });
    const b = await enqueueJob(db, { type: 'PING', entityId: 'demo', input: { x: 1 } });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it('different input produces a distinct job', async () => {
    const a = await enqueueJob(db, { type: 'PING', entityId: 'demo', input: { x: 1 } });
    const b = await enqueueJob(db, { type: 'PING', entityId: 'demo', input: { x: 2 } });
    expect(b.job.id).not.toBe(a.job.id);
  });

  it('claims a job at most once under concurrency (SKIP LOCKED)', async () => {
    await enqueueJob(db, { type: 'PING', entityId: 'e1', input: {} });
    const results = await Promise.all(Array.from({ length: 5 }, () => claimNextJob(db)));
    const claimed = results.filter((row) => row !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe('RUNNING');
    expect(claimed[0]?.attempts).toBe(1);
  });

  it('transitions PENDING -> RUNNING -> COMPLETED', async () => {
    const { job } = await enqueueJob(db, { type: 'PING', entityId: 'e2', input: {} });
    const claimed = await claimNextJob(db, { entityId: 'e2' });
    expect(claimed?.id).toBe(job.id);
    const done = await completeJob(db, job.id, { ok: true });
    expect(done?.status).toBe('COMPLETED');
    expect(done?.result).toEqual({ ok: true });
  });

  it('retryable failure returns to PENDING until max attempts', async () => {
    const { job } = await enqueueJob(db, {
      type: 'PING',
      entityId: 'e3',
      input: {},
      maxAttempts: 2,
    });
    await claimNextJob(db, { entityId: 'e3' });
    const retried = await failJob(db, job.id, { code: 'X', message: 'boom', retryable: true });
    expect(retried?.status).toBe('PENDING');

    await claimNextJob(db, { entityId: 'e3' });
    const failed = await failJob(db, job.id, { code: 'X', message: 'boom', retryable: true });
    expect(failed?.status).toBe('FAILED');
  });
});
