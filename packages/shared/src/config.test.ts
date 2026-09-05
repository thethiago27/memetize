import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('uses TEST_DATABASE_URL when DATABASE_URL is absent', () => {
    const config = loadConfig({
      TEST_DATABASE_URL: 'postgres://memetize/memetize_test',
      STORAGE_PATH: './storage',
    });
    expect(config.databaseUrl).toBe('postgres://memetize/memetize_test');
    expect(config.testDatabaseUrl).toBe('postgres://memetize/memetize_test');
  });

  it('keeps DATABASE_URL when both are set', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://memetize/memetize',
      TEST_DATABASE_URL: 'postgres://memetize/memetize_test',
      STORAGE_PATH: './storage',
    });
    expect(config.databaseUrl).toBe('postgres://memetize/memetize');
    expect(config.testDatabaseUrl).toBe('postgres://memetize/memetize_test');
  });

  it('still requires a database url when neither is set', () => {
    expect(() => loadConfig({ STORAGE_PATH: './storage' })).toThrow(/DATABASE_URL/);
  });
});
