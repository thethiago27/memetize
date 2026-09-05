import { spawn } from 'node:child_process';
import { WorkerResult } from '@memetize/contracts';

export interface PythonRunOptions {
  cwd: string;
  module: string;
  request: unknown;
  /** Defaults to `uv`. */
  command?: string;
  /** Defaults to `['run', 'python', '-m', module]`. */
  args?: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface PythonRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Runs a Python worker as a subprocess following the Node<->Python protocol
 * (spec section 10): the request is written to stdin, the single JSON response
 * is read from stdout, logs come out on stderr.
 *
 * A non-zero exit is NOT treated as a transport failure here (F14): the worker
 * writes a structured `WorkerFailure` to stdout and exits 1, so rejecting on the
 * exit code alone would discard its error code/message/retryability. Only spawn
 * errors and timeouts reject; the caller decodes the result with
 * `decodePythonResponse`, which interprets stdout even on a non-zero exit.
 */
export function runPythonWorker(options: PythonRunOptions): Promise<PythonRunResult> {
  const command = options.command ?? 'uv';
  const args = options.args ?? ['run', 'python', '-m', options.module];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill('SIGKILL');
          reject(
            new Error(`Python worker '${options.module}' timed out after ${options.timeoutMs}ms`),
          );
        }, options.timeoutMs)
      : null;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (exitCode, signal) => {
      finish(() => resolvePromise({ stdout, stderr, exitCode, signal }));
    });

    child.stdin.write(JSON.stringify(options.request));
    child.stdin.end();
  });
}

/**
 * Decodes a Python worker's response into a `WorkerResult` (F14), preserving a
 * structured failure emitted with a non-zero exit. A declared `failed` result is
 * returned with its code/message/retryability intact; anything else — invalid
 * JSON, a mismatched jobId, a process killed by a signal, or a `success` that
 * exited non-zero — is a protocol error, so an inconsistent subprocess can never
 * be reported as success.
 */
export function decodePythonResponse(run: PythonRunResult, expectedJobId: string): WorkerResult {
  let raw: unknown;
  try {
    raw = JSON.parse(run.stdout);
  } catch {
    throw new Error(`PYTHON_PROTOCOL_INVALID_JSON: exit=${run.exitCode}`);
  }
  const parsed = WorkerResult.safeParse(raw);
  if (!parsed.success || parsed.data.jobId !== expectedJobId) {
    throw new Error('PYTHON_PROTOCOL_INVALID_RESPONSE');
  }
  if (run.signal !== null) {
    throw new Error(`PYTHON_PROCESS_INTERRUPTED: ${run.signal}`);
  }
  const result = parsed.data;
  if (result.status === 'failed') {
    return result; // Preserves error.code, error.message and error.retryable.
  }
  if (run.exitCode !== 0) {
    throw new Error(`PYTHON_PROTOCOL_SUCCESS_WITH_EXIT_${run.exitCode}`);
  }
  return result;
}
