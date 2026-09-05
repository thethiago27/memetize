import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from './testing';

/**
 * F15: createTestDatabase must only return null for the deliberate "no test DB
 * requested" case. A requested-but-broken database has to surface an error so a
 * broken migration or unreachable DB cannot masquerade as a skip.
 */
describe('createTestDatabase error behavior', () => {
  const original = {
    url: process.env.TEST_DATABASE_URL,
    require: process.env.REQUIRE_INTEGRATION_TESTS,
  };

  beforeEach(() => {
    process.env.TEST_DATABASE_URL = undefined;
    process.env.REQUIRE_INTEGRATION_TESTS = undefined;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.REQUIRE_INTEGRATION_TESTS;
  });

  afterEach(() => {
    if (original.url === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = original.url;
    if (original.require === undefined) delete process.env.REQUIRE_INTEGRATION_TESTS;
    else process.env.REQUIRE_INTEGRATION_TESTS = original.require;
  });

  it('returns null when no URL is configured and integration is not required', async () => {
    await expect(createTestDatabase()).resolves.toBeNull();
  });

  it('throws when integration tests are required but no URL is configured', async () => {
    process.env.REQUIRE_INTEGRATION_TESTS = '1';
    await expect(createTestDatabase()).rejects.toThrow(/TEST_DATABASE_URL is required/);
  });

  it('propagates connection failures instead of swallowing them into a skip', async () => {
    // Port 1 is never a Postgres server: the connection/`select 1` must fail and
    // that failure must propagate rather than resolve to null.
    process.env.TEST_DATABASE_URL = 'postgres://memetize:memetize@127.0.0.1:1/does_not_exist';
    await expect(createTestDatabase()).rejects.toThrow();
  });
});
