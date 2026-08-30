import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPythonWorker } from '@memetize/shared';
import { describe, expect, it } from 'vitest';

const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));
// Only run once the Python environment has been provisioned (`uv sync`).
const pyEnvReady = existsSync(join(WORKER_DIR, '.venv'));

describe.skipIf(!pyEnvReady)('audio-analyzer python worker (integration)', () => {
  it('emits a valid WorkerResult with integer-ms beats/sections over the protocol', async () => {
    const { stdout } = await runPythonWorker({
      cwd: WORKER_DIR,
      module: 'audio_analyzer',
      request: {
        jobId: 'job_1',
        entityId: 'prj_1',
        workerVersion: '1.0.0',
        input: { projectId: 'prj_1', durationMs: 6000 },
      },
      timeoutMs: 60_000,
    });

    const payload = JSON.parse(stdout);
    expect(payload.status).toBe('success');
    expect(payload.output.projectId).toBe('prj_1');
    expect(payload.output.bpm).toBe(120);
    expect(Array.isArray(payload.output.beats)).toBe(true);
    expect(payload.output.beats.length).toBeGreaterThanOrEqual(1);
    const first = payload.output.beats[0];
    expect(Number.isInteger(first.timeMs)).toBe(true);
    expect(payload.output.sections.length).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic for a given duration', async () => {
    const run = () =>
      runPythonWorker({
        cwd: WORKER_DIR,
        module: 'audio_analyzer',
        request: {
          jobId: 'job_1',
          entityId: 'prj_1',
          workerVersion: '1.0.0',
          input: { projectId: 'prj_1', durationMs: 6000 },
        },
        timeoutMs: 60_000,
      });

    const first = JSON.parse((await run()).stdout);
    const second = JSON.parse((await run()).stdout);
    expect(first.output).toEqual(second.output);
  });
});
