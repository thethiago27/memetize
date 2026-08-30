import type { AppConfig } from '@memetize/shared';
import { describe, expect, it } from 'vitest';
import { assetDir, assetFile, frameFile, resolveStorage, visionDebugFile } from './paths';

const config: AppConfig = {
  databaseUrl: 'x',
  testDatabaseUrl: null,
  rootDir: '/repo',
  storageDir: '/repo/storage',
  storageDirRelative: 'storage',
  resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
  embeddingDimensions: 384,
  providers: {
    transcription: { kind: 'fixture', model: null },
    vision: { kind: 'fixture', model: null },
    llm: { kind: 'fixture', model: null },
    embedding: { kind: 'fixture', model: null },
  },
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

  it('builds zero-padded frame files under the scene dir', () => {
    const frame = frameFile(config, 'ast_1', 'scn_1', 1500);
    expect(frame.absolute).toBe('/repo/storage/frames/ast_1/scn_1/frame_001500.jpg');
    expect(frame.relative).toBe('storage/frames/ast_1/scn_1/frame_001500.jpg');
  });

  it('builds a vision debug cache path per scene', () => {
    const debug = visionDebugFile(config, 'ast_1', 'scn_1');
    expect(debug.absolute).toBe('/repo/storage/cache/ast_1/vision/scn_1.json');
  });
});
