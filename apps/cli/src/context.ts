import { type AppRuntime, createAppRuntime } from '@memetize/runtime';

export type CliContext = AppRuntime;

/** Builds the shared runtime (config, DB, orchestrator) for a CLI invocation. */
export function buildContext(): Promise<CliContext> {
  return Promise.resolve(createAppRuntime());
}
