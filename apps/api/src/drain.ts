import type { AppRuntime } from '@memetize/runtime';

/** Fire-and-forget drain so HTTP never blocks on a RENDER (spec section 6). */
export function kickDrain(runtime: AppRuntime, entityId: string): void {
  void runtime.orchestrator.drain({ entityId }).catch((error: unknown) => {
    runtime.logger.error('drain_failed', {
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
