import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { getAsset, ingestAsset, listScenes } from '@memetize/media-catalog';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import { SCENE_DETECTOR_DIR } from '@memetize/scene-detector';
import type { AppConfig } from '@memetize/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRegistry } from './registry';

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
const pyEnvReady = existsSync(join(SCENE_DETECTOR_DIR, '.venv'));

async function makeCutsClip(path: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=1280x720:d=2:r=30',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=1280x720:d=2:r=30',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=1280x720:d=2:r=30',
    '-f',
    'lavfi',
    '-i',
    'color=c=yellow:s=1280x720:d=2:r=30',
    '-filter_complex',
    '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]',
    '-map',
    '[v]',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

describe.skipIf(!handle || !ffmpegAvailable || !pyEnvReady)('asset pipeline (e2e)', () => {
  let tmp: string;
  let config: AppConfig;
  let orchestrator: Orchestrator;
  let fixture: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-e2e-'));
    config = {
      databaseUrl: 'unused',
      testDatabaseUrl: null,
      rootDir: tmp,
      storageDir: join(tmp, 'storage'),
      storageDirRelative: 'storage',
      resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
    };
    orchestrator = new Orchestrator({
      db,
      config,
      registry: buildRegistry(),
      scheduler: new ResourceScheduler(config.resources),
    });
    fixture = join(tmp, 'test-cuts.mp4');
    await makeCutsClip(fixture);
    await truncateAll(db);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('ingests, normalizes, detects scenes, dedups, and is idempotent', async () => {
    const { asset, created } = await ingestAsset({ db, config, filePath: fixture });
    expect(created).toBe(true);

    const outcomes = await orchestrator.drain({ entityId: asset.id });
    expect(outcomes.map((outcome) => outcome.job.type)).toEqual([
      'VIDEO_NORMALIZE',
      'SCENE_DETECT',
    ]);
    expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    const refreshed = await getAsset(db, asset.id);
    expect(refreshed?.status).toBe('ANALYZING');
    expect(refreshed?.proxyPath).toBeTruthy();
    expect(refreshed?.analysisPath).toBeTruthy();
    expect(existsSync(join(config.rootDir, refreshed?.proxyPath ?? ''))).toBe(true);
    expect(existsSync(join(config.rootDir, refreshed?.analysisPath ?? ''))).toBe(true);
    expect(existsSync(join(config.rootDir, refreshed?.thumbnailPath ?? ''))).toBe(true);

    const scenes = await listScenes(db, asset.id);
    // red -> green -> blue -> yellow => at least a couple of hard cuts.
    expect(scenes.length).toBeGreaterThanOrEqual(2);
    for (const scene of scenes) {
      expect(Number.isInteger(scene.startMs)).toBe(true);
      expect(Number.isInteger(scene.endMs)).toBe(true);
      expect(scene.endMs).toBeGreaterThan(scene.startMs);
    }

    // Re-adding the same bytes must not create a second asset.
    const again = await ingestAsset({ db, config, filePath: fixture });
    expect(again.created).toBe(false);
    expect(again.asset.id).toBe(asset.id);

    // Re-draining processes nothing (all jobs COMPLETED) and never duplicates scenes.
    const more = await orchestrator.drain({ entityId: asset.id });
    expect(more).toHaveLength(0);
    const scenesAfter = await listScenes(db, asset.id);
    expect(scenesAfter).toHaveLength(scenes.length);
  }, 60_000);
});
