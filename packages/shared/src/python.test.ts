import { describe, expect, it } from 'vitest';
import { decodePythonResponse, type PythonRunResult } from './python';

function run(overrides: Partial<PythonRunResult>): PythonRunResult {
  return { stdout: '', stderr: '', exitCode: 0, signal: null, ...overrides };
}

const JOB = 'job_1';

describe('decodePythonResponse (F14)', () => {
  it('preserves a declared failure emitted with a non-zero exit', () => {
    const stdout = JSON.stringify({
      jobId: JOB,
      status: 'failed',
      error: { code: 'MODEL_NOT_INSTALLED', message: 'dependency missing', retryable: true },
    });
    const result = decodePythonResponse(run({ stdout, exitCode: 1 }), JOB);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.code).toBe('MODEL_NOT_INSTALLED');
      expect(result.error.message).toBe('dependency missing');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('accepts a success emitted with exit 0', () => {
    const stdout = JSON.stringify({
      jobId: JOB,
      status: 'success',
      output: { ok: true },
      metadata: { processingTimeMs: 5, workerVersion: '1.0.0' },
    });
    const result = decodePythonResponse(run({ stdout, exitCode: 0 }), JOB);
    expect(result.status).toBe('success');
  });

  it('rejects invalid JSON as a protocol error', () => {
    expect(() => decodePythonResponse(run({ stdout: 'not json', exitCode: 1 }), JOB)).toThrow(
      /PYTHON_PROTOCOL_INVALID_JSON/,
    );
  });

  it('rejects a success that exited non-zero', () => {
    const stdout = JSON.stringify({
      jobId: JOB,
      status: 'success',
      output: {},
      metadata: { processingTimeMs: 1, workerVersion: '1.0.0' },
    });
    expect(() => decodePythonResponse(run({ stdout, exitCode: 1 }), JOB)).toThrow(
      /PYTHON_PROTOCOL_SUCCESS_WITH_EXIT_1/,
    );
  });

  it('rejects a mismatched jobId', () => {
    const stdout = JSON.stringify({
      jobId: 'other',
      status: 'failed',
      error: { code: 'X', message: 'y', retryable: false },
    });
    expect(() => decodePythonResponse(run({ stdout, exitCode: 1 }), JOB)).toThrow(
      /PYTHON_PROTOCOL_INVALID_RESPONSE/,
    );
  });

  it('rejects a response killed by a signal', () => {
    const stdout = JSON.stringify({
      jobId: JOB,
      status: 'failed',
      error: { code: 'X', message: 'y', retryable: false },
    });
    expect(() =>
      decodePythonResponse(run({ stdout, exitCode: null, signal: 'SIGKILL' }), JOB),
    ).toThrow(/PYTHON_PROCESS_INTERRUPTED/);
  });
});
