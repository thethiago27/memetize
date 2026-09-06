import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { requireIntegrationDependency, runPythonWorker } from '@memetize/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));
// Only run once the Python environment has been provisioned (`uv sync`).
const pyEnvReady = requireIntegrationDependency(
  'the scene-detector Python virtualenv (pnpm py:sync)',
  existsSync(join(WORKER_DIR, '.venv')),
);

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}
const ffmpegAvailable = requireIntegrationDependency('ffmpeg', await hasFfmpeg());

describe.skipIf(!pyEnvReady || !ffmpegAvailable)(
  'scene-detector python worker (integration)',
  () => {
    let tmp: string;
    let clip: string;

    beforeAll(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'memetize-scene-'));
      clip = join(tmp, 'analysis.mp4');
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=320x240:rate=30',
        '-pix_fmt',
        'yuv420p',
        clip,
      ]);
    });

    afterAll(async () => {
      if (tmp) await rm(tmp, { recursive: true, force: true });
    });

    it('emits a valid WorkerResult with integer-ms scenes over the protocol', async () => {
      const { stdout } = await runPythonWorker({
        cwd: WORKER_DIR,
        module: 'scene_detector',
        request: {
          jobId: 'job_1',
          entityId: 'ast_1',
          workerVersion: '1.0.0',
          input: { assetId: 'ast_1', analysisPath: clip },
        },
        timeoutMs: 120_000,
      });

      const payload = JSON.parse(stdout);
      expect(payload.status).toBe('success');
      expect(payload.output.assetId).toBe('ast_1');
      expect(Array.isArray(payload.output.scenes)).toBe(true);
      expect(payload.output.scenes.length).toBeGreaterThanOrEqual(1);
      const first = payload.output.scenes[0];
      expect(Number.isInteger(first.startMs)).toBe(true);
      expect(Number.isInteger(first.endMs)).toBe(true);
    });
  },
);
