import { createTestDatabase, type Database, jobs, truncateAll } from '@memetize/database';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { claimNextJob, renewLease } from './claim';
import { completeJob, failJob, reconcileExpiredLeases } from './complete';
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
    expect(claimed[0]?.job.status).toBe('RUNNING');
    expect(claimed[0]?.job.attempts).toBe(1);
    expect(claimed[0]?.leaseToken).toBeTruthy();
  });

  it('transitions PENDING -> RUNNING -> COMPLETED', async () => {
    const { job } = await enqueueJob(db, { type: 'PING', entityId: 'e2', input: {} });
    const claimed = await claimNextJob(db, { entityId: 'e2' });
    expect(claimed?.job.id).toBe(job.id);
    const done = await completeJob(db, job.id, { ok: true }, claimed?.leaseToken);
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

  it('reclaims a RUNNING job once its lease expires (F08)', async () => {
    const { job } = await enqueueJob(db, { type: 'PING', entityId: 'e4', input: {} });
    const first = await claimNextJob(db, { entityId: 'e4' });
    expect(first?.job.id).toBe(job.id);
    // A second claim cannot take a freshly leased job.
    expect(await claimNextJob(db, { entityId: 'e4' })).toBeNull();
    // Force the lease into the past, then it becomes reclaimable.
    await db
      .update(jobs)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(jobs.id, job.id));
    const reclaimed = await claimNextJob(db, { entityId: 'e4' });
    expect(reclaimed?.job.id).toBe(job.id);
    expect(reclaimed?.job.attempts).toBe(2);
    expect(reclaimed?.leaseToken).not.toBe(first?.leaseToken);
  });

  it('a stale attempt cannot complete after the job is reclaimed (F08)', async () => {
    const { job } = await enqueueJob(db, { type: 'PING', entityId: 'e5', input: {} });
    const stale = await claimNextJob(db, { entityId: 'e5' });
    await db
      .update(jobs)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(jobs.id, job.id));
    const fresh = await claimNextJob(db, { entityId: 'e5' });
    expect(fresh?.job.id).toBe(job.id);
    // The stale worker's lease-guarded completion must be rejected.
    const lost = await completeJob(db, job.id, { ok: true }, stale?.leaseToken);
    expect(lost).toBeNull();
    // Renewing the stale lease also fails.
    expect(await renewLease(db, job.id, stale?.leaseToken ?? '')).toBe(false);
    // The current owner can still complete.
    const done = await completeJob(db, job.id, { ok: true }, fresh?.leaseToken);
    expect(done?.status).toBe('COMPLETED');
  });

  it('reconciles an expired lease with no attempts left to FAILED (F08)', async () => {
    const { job } = await enqueueJob(db, { type: 'PING', entityId: 'e6', input: {}, maxAttempts: 1 });
    await claimNextJob(db, { entityId: 'e6' });
    await db
      .update(jobs)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(jobs.id, job.id));
    const reconciled = await reconcileExpiredLeases(db);
    expect(reconciled.map((row) => row.id)).toContain(job.id);
    const row = await db.query.jobs.findFirst({ where: eq(jobs.id, job.id) });
    expect(row?.status).toBe('FAILED');
    expect(row?.errorCode).toBe('LEASE_EXPIRED');
  });
});
