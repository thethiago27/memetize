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

/**
 * Environment passed through to a Python worker. The parent's whole `process.env`
 * used to be forwarded, which handed every subprocess `AI_GATEWAY_API_KEY` and
 * `DATABASE_URL` — credentials no Python worker needs. Only what a Python
 * toolchain actually requires is inherited; anything else a worker needs is
 * passed explicitly through `options.env`.
 */
const INHERITED_ENV_KEYS = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SHELL',
  'USER',
  'LOGNAME',
  'SystemRoot',
  'PATHEXT',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONUNBUFFERED',
  'VIRTUAL_ENV',
  'UV_CACHE_DIR',
  'UV_PYTHON',
  'UV_PROJECT_ENVIRONMENT',
  'HF_HOME',
  'HUGGINGFACE_HUB_CACHE',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
] as const;

function inheritedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) inherited[key] = value;
  }
  return inherited;
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
  const env = { ...inheritedEnv(process.env), ...options.env };

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
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

    // A worker that dies before reading its request makes this write fail with
    // EPIPE. Without a listener that `error` is unhandled on the stream and
    // takes the whole worker process down, so it is swallowed here: `close`
    // still fires and the caller sees the real exit code and stderr.
    child.stdin.on('error', () => undefined);
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
