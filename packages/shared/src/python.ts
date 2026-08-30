import { spawn } from 'node:child_process';

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
}

/**
 * Runs a Python worker as a subprocess following the Node<->Python protocol
 * (spec section 10): the request is written to stdin, the single JSON response
 * is read from stdout, logs come out on stderr, and a non-zero exit is failure.
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
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolvePromise({ stdout, stderr });
        } else {
          reject(
            new Error(
              `Python worker '${options.module}' exited with code ${code}: ${stderr.trim()}`,
            ),
          );
        }
      });
    });

    child.stdin.write(JSON.stringify(options.request));
    child.stdin.end();
  });
}
