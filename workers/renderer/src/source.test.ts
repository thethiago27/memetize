import { describe, expect, it } from 'vitest';
import { chooseRenderSource } from './source';

describe('chooseRenderSource (F06)', () => {
  const asset = {
    originalPath: 'storage/assets/ast_1/original.mp4',
    proxyPath: 'storage/assets/ast_1/proxy.mp4',
  };

  it('exports from the original for a final render', () => {
    expect(chooseRenderSource(asset, 'final')).toEqual({
      path: asset.originalPath,
      origin: 'original',
    });
  });

  it('uses the proxy for a preview render', () => {
    expect(chooseRenderSource(asset, 'preview')).toEqual({
      path: asset.proxyPath,
      origin: 'proxy',
    });
  });

  it('still uses the original for a preview when no proxy exists', () => {
    expect(chooseRenderSource({ ...asset, proxyPath: null }, 'preview')).toEqual({
      path: asset.originalPath,
      origin: 'original',
    });
  });

  it('fails a final render when the original is gone instead of degrading to the proxy', () => {
    expect(() =>
      chooseRenderSource({ originalPath: null, proxyPath: asset.proxyPath }, 'final'),
    ).toThrow(/ORIGINAL_NOT_AVAILABLE/);
  });
});
