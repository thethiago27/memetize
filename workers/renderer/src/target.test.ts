import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allocateRenderTarget, cleanupOrphanRenderAttempts } from './target';

describe('render targets (F09)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memetize-render-target-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('allocates a private directory per attempt with encoding and ready paths', async () => {
    const a = await allocateRenderTarget(dir);
    const b = await allocateRenderTarget(dir);
    expect(a.directory).not.toBe(b.directory);
    expect(a.encodingPath).toBe(join(a.directory, 'encoding.mp4'));
    expect(a.readyPath).toBe(join(a.directory, 'ready.mp4'));
  });

  it('removes only stale attempt directories, never published renders or fresh attempts', async () => {
    const stale = await allocateRenderTarget(dir);
    await writeFile(stale.readyPath, 'orphan');
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await utimes(stale.directory, old, old);

    const fresh = await allocateRenderTarget(dir);
    await writeFile(fresh.encodingPath, 'in progress');
    await writeFile(join(dir, 'render_001.mp4'), 'published');
    await mkdir(join(dir, 'unrelated'));

    const removed = await cleanupOrphanRenderAttempts(dir);
    expect(removed).toBe(1);
    expect(existsSync(stale.directory)).toBe(false);
    expect(existsSync(fresh.encodingPath)).toBe(true);
    expect(existsSync(join(dir, 'render_001.mp4'))).toBe(true);
    expect(existsSync(join(dir, 'unrelated'))).toBe(true);
  });

  it('is a no-op on a missing renders directory', async () => {
    expect(await cleanupOrphanRenderAttempts(join(dir, 'nope'))).toBe(0);
  });
});
