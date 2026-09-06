import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { probeVideo } from '@memetize/media-catalog';
import { requireIntegrationDependency } from '@memetize/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeVideo } from './normalize';

const execFileAsync = promisify(execFile);

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}
const ffmpegAvailable = await hasFfmpeg();

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const available = requireIntegrationDependency('ffmpeg', ffmpegAvailable);

describe.skipIf(!available)('normalizeVideo (integration)', () => {
  let tmp: string;
  let source: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-norm-'));
    source = join(tmp, 'source.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=1280x720:rate=30',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
  });

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('produces a 720p30 proxy, a 480p15 analysis, and a thumbnail', async () => {
    const proxyPath = join(tmp, 'proxy.mp4');
    const analysisPath = join(tmp, 'analysis.mp4');
    const thumbnailPath = join(tmp, 'thumbnail.jpg');

    await normalizeVideo({ originalPath: source, proxyPath, analysisPath, thumbnailPath });

    expect(await exists(proxyPath)).toBe(true);
    expect(await exists(analysisPath)).toBe(true);
    expect(await exists(thumbnailPath)).toBe(true);

    const proxy = await probeVideo(proxyPath);
    expect(proxy.height).toBe(720);
    expect(proxy.fpsMilli).toBe(30000);

    const analysis = await probeVideo(analysisPath);
    expect(analysis.height).toBe(480);
    expect(analysis.fpsMilli).toBe(15000);
  });
});
