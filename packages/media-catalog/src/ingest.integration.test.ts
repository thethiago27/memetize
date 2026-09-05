import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { listJobsForEntity } from '@memetize/job-system';
import type { AppConfig } from '@memetize/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingestAsset } from './ingest';

const execFileAsync = promisify(execFile);
const handle = await createTestDatabase();
const db = handle?.db as Database;

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}
const ffmpegAvailable = await hasFfmpeg();

describe.skipIf(!handle || !ffmpegAvailable)('ingestAsset (integration)', () => {
  let tmp: string;
  let config: AppConfig;
  let samplePath: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-'));
    config = {
      databaseUrl: 'x',
      testDatabaseUrl: null,
      rootDir: tmp,
      storageDir: join(tmp, 'storage'),
      storageDirRelative: 'storage',
      resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
      embeddingDimensions: 384,
      providerMode: 'demo',
      providers: {
        transcription: { kind: 'fixture', model: null },
        vision: { kind: 'fixture', model: null },
        llm: { kind: 'fixture', model: null },
        embedding: { kind: 'fixture', model: null },
        audio: { kind: 'fixture', model: null },
      },
    };
    samplePath = join(tmp, 'sample.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=320x240:rate=30',
      '-pix_fmt',
      'yuv420p',
      samplePath,
    ]);
  });

  afterAll(async () => {
    await handle?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it('ingests a video, probes metadata, and enqueues normalization', async () => {
    const { asset, created } = await ingestAsset({ db, config, filePath: samplePath });
    expect(created).toBe(true);
    expect(asset.status).toBe('INGESTED');
    expect(asset.width).toBe(320);
    expect(asset.height).toBe(240);
    expect(asset.durationMs).toBeGreaterThan(0);
    expect(asset.fpsMilli).toBeGreaterThan(0);

    const jobs = await listJobsForEntity(db, asset.id);
    expect(jobs.map((job) => job.type)).toContain('VIDEO_NORMALIZE');
  });

  it('deduplicates by checksum instead of creating a second asset', async () => {
    const first = await ingestAsset({ db, config, filePath: samplePath });
    const second = await ingestAsset({ db, config, filePath: samplePath });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.asset.id).toBe(first.asset.id);
  });
});
