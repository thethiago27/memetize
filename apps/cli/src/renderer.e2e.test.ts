import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_ANALYZER_DIR } from '@memetize/audio-analyzer';
import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { ingestAsset, probeVideo } from '@memetize/media-catalog';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import {
  getLatestRender,
  getProject,
  ingestProject,
  listRenders,
  renderDebugFile,
  renderProject,
  resolveStorage,
} from '@memetize/projects';
import { SCENE_DETECTOR_DIR } from '@memetize/scene-detector';
import type { AppConfig } from '@memetize/shared';
import { TRANSCRIPT_DIR } from '@memetize/transcript';
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
const pyEnvReady =
  existsSync(join(AUDIO_ANALYZER_DIR, '.venv')) &&
  existsSync(join(SCENE_DETECTOR_DIR, '.venv')) &&
  existsSync(join(TRANSCRIPT_DIR, '.venv'));

async function makeSilentClip(path: string, durationSeconds: number): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=44100:cl=mono:d=${durationSeconds}`,
    path,
  ]);
}

async function makeColorClip(path: string, color: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=640x360:d=2:r=30`,
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

describe.skipIf(!handle || !ffmpegAvailable || !pyEnvReady)('renderer pipeline (e2e)', () => {
  let tmp: string;
  let config: AppConfig;
  let orchestrator: Orchestrator;
  let songFixture: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-renderer-e2e-'));
    config = {
      databaseUrl: 'unused',
      testDatabaseUrl: null,
      rootDir: tmp,
      storageDir: join(tmp, 'storage'),
      storageDirRelative: 'storage',
      resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
      embeddingDimensions: 384,
      providers: {
        transcription: { kind: 'fixture', model: null },
        vision: { kind: 'fixture', model: null },
        llm: { kind: 'fixture', model: null },
        embedding: { kind: 'fixture', model: null },
        audio: { kind: 'fixture', model: null },
      },
    };
    orchestrator = new Orchestrator({
      db,
      config,
      registry: buildRegistry(),
      scheduler: new ResourceScheduler(config.resources),
    });
    songFixture = join(tmp, 'song.mp3');
    await makeSilentClip(songFixture, 6);
    await truncateAll(db);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('renders a catalog-backed timeline into a valid 1080x1920@30 MP4 and supports a second version', async () => {
    const colors = ['red', 'green', 'blue'];
    for (const [index, color] of colors.entries()) {
      const clipPath = join(tmp, `clip-${index}-${color}.mp4`);
      await makeColorClip(clipPath, color);
      const { asset } = await ingestAsset({ db, config, filePath: clipPath });
      const outcomes = await orchestrator.drain({ entityId: asset.id });
      expect(outcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    }

    const { project } = await ingestProject({ db, config, filePath: songFixture });
    const createOutcomes = await orchestrator.drain({ entityId: project.id });
    expect(createOutcomes.every((outcome) => outcome.status === 'COMPLETED')).toBe(true);

    // `project create` never renders — it stops at TIMELINE_READY (spec section 42).
    expect((await getProject(db, project.id))?.status).toBe('TIMELINE_READY');
    expect(createOutcomes.some((outcome) => outcome.job.type === 'RENDER')).toBe(false);

    await renderProject(db, project.id);
    const renderOutcomes = await orchestrator.drain({ entityId: project.id });
    expect(renderOutcomes.map((outcome) => outcome.job.type)).toEqual(['RENDER']);
    expect(renderOutcomes[0]?.status).toBe('COMPLETED');

    expect((await getProject(db, project.id))?.status).toBe('COMPLETED');

    const renders = await listRenders(db, project.id);
    expect(renders).toHaveLength(1);
    const render = renders[0];
    expect(render?.version).toBe(1);
    const renderPath = resolveStorage(config, render?.path ?? '');
    expect(existsSync(renderPath)).toBe(true);

    const probe = await probeVideo(renderPath);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    expect(probe.fpsMilli).toBe(30000);
    expect(probe.audioCodec).toBeTruthy();
    expect(Math.abs(probe.durationMs - 6000)).toBeLessThanOrEqual(200);

    const debug = JSON.parse(await readFile(renderDebugFile(config, project.id).absolute, 'utf8'));
    expect(Array.isArray(debug.args)).toBe(true);
    expect(debug.validation.valid).toBe(true);

    // Re-draining processes nothing (RENDER already COMPLETED) and never creates v2.
    const more = await orchestrator.drain({ entityId: project.id });
    expect(more).toHaveLength(0);
    expect(await listRenders(db, project.id)).toHaveLength(1);

    // A second `renderProject` forces v2 without touching v1.
    await renderProject(db, project.id);
    const secondOutcomes = await orchestrator.drain({ entityId: project.id });
    expect(secondOutcomes.map((outcome) => outcome.job.type)).toEqual(['RENDER']);
    expect(secondOutcomes[0]?.status).toBe('COMPLETED');

    const rendersAfterSecond = await listRenders(db, project.id);
    expect(rendersAfterSecond.map((r) => r.version).sort()).toEqual([1, 2]);
    const v1 = rendersAfterSecond.find((r) => r.version === 1);
    expect(v1?.path).toBe(render?.path);
    expect(existsSync(resolveStorage(config, v1?.path ?? ''))).toBe(true);
    const v2 = rendersAfterSecond.find((r) => r.version === 2);
    expect(v2?.path).toContain('render_002.mp4');
    expect((await getProject(db, project.id))?.status).toBe('COMPLETED');
  }, 120_000);

  it('fails at director with INSUFFICIENT_CATALOG and never renders when there is no catalog', async () => {
    await truncateAll(db);

    const { project } = await ingestProject({ db, config, filePath: songFixture });
    const outcomes = await orchestrator.drain({ entityId: project.id });
    const director = outcomes.find((outcome) => outcome.job.type === 'DIRECTOR');

    expect((await getProject(db, project.id))?.status).toBe('FAILED');
    expect(director?.status).toBe('FAILED');
    expect(director?.error?.code).toBe('INSUFFICIENT_CATALOG');
    expect(outcomes.some((outcome) => outcome.job.type === 'RENDER')).toBe(false);
    expect(await getLatestRender(db, project.id)).toBeUndefined();
  }, 60_000);
});
