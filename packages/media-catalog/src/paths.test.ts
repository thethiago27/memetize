import type { AppConfig } from '@memetize/shared';
import { describe, expect, it } from 'vitest';
import { assetDir, assetFile, resolveStorage } from './paths';

const config: AppConfig = {
  databaseUrl: 'x',
  testDatabaseUrl: null,
  rootDir: '/repo',
  storageDir: '/repo/storage',
  storageDirRelative: 'storage',
  resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
};

describe('asset paths', () => {
  it('builds absolute and repo-relative asset dirs', () => {
    const dir = assetDir(config, 'ast_1');
    expect(dir.absolute).toBe('/repo/storage/assets/ast_1');
    expect(dir.relative).toBe('storage/assets/ast_1');
  });

  it('builds named files inside the asset dir', () => {
    const proxy = assetFile(config, 'ast_1', 'proxy.mp4');
    expect(proxy.absolute).toBe('/repo/storage/assets/ast_1/proxy.mp4');
    expect(proxy.relative).toBe('storage/assets/ast_1/proxy.mp4');
  });

  it('resolves a stored relative path back to absolute', () => {
    expect(resolveStorage(config, 'storage/assets/ast_1/original.mp4')).toBe(
      '/repo/storage/assets/ast_1/original.mp4',
    );
  });
});
