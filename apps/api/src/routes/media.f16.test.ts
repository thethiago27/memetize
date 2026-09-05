import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppRuntime } from '@memetize/runtime';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerMediaRoutes } from './media';

/**
 * F16: the media endpoint must only serve media files from inside the storage
 * directory. Config files, non-media types, directories, and symlinks that
 * escape storage must all be refused; legitimate media (with Range) is served.
 */
describe('media route storage confinement (F16)', () => {
  let app: FastifyInstance;
  let rootDir: string;

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'memetize-f16-'));
    const storageDir = join(rootDir, 'storage');
    writeFileSync(join(rootDir, 'package.json'), '{"secret":true}');
    // Media file under storage.
    const mediaDir = join(storageDir, 'renders', 'prj_1');
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, 'render_001.mp4'), Buffer.alloc(2048, 1));
    // A symlink under storage pointing at the repo-root secret.
    symlinkSync(join(rootDir, 'package.json'), join(storageDir, 'escape.mp4'));

    app = Fastify();
    const runtime = { config: { rootDir, storageDir } } as unknown as AppRuntime;
    registerMediaRoutes(app, runtime);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('serves a legitimate media file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/storage/renders/prj_1/render_001.mp4',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('video/mp4');
  });

  it('honors a byte range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/storage/renders/prj_1/render_001.mp4',
      headers: { range: 'bytes=0-99' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-99/2048');
  });

  it('refuses package.json under the repo root', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/media/package.json' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('refuses a path traversal', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/media/../package.json' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('refuses a symlink that escapes storage', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/media/storage/escape.mp4' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('refuses a directory', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/media/storage/renders/prj_1' });
    expect(res.statusCode).toBe(404);
  });
});
