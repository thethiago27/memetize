export interface LogContext {
  jobId?: string;
  worker?: string;
  workerVersion?: string;
  entityId?: string;
  [key: string]: unknown;
}

export interface Logger {
  child(context: LogContext): Logger;
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(
  level: Level,
  base: LogContext,
  event: string,
  data?: Record<string, unknown>,
): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), event, ...base, ...data });
  // Structured logs go to stderr so stdout stays reserved for the worker protocol.
  process.stderr.write(`${line}\n`);
}

/** Structured JSON logger. Every line carries the bound context (jobId, worker, ...). */
export function createLogger(base: LogContext = {}): Logger {
  return {
    child: (context) => createLogger({ ...base, ...context }),
    debug: (event, data) => write('debug', base, event, data),
    info: (event, data) => write('info', base, event, data),
    warn: (event, data) => write('warn', base, event, data),
    error: (event, data) => write('error', base, event, data),
  };
}
