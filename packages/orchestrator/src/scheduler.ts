import type { ResourceClass } from '@memetize/contracts';

interface Semaphore {
  limit: number;
  active: number;
  queue: Array<() => void>;
}

/**
 * Counting semaphores per resource class (spec section 8). Keeps the M4 from
 * running more heavy workloads than it can handle: e.g. one CPU_HEAVY normalize
 * and one RENDER at a time, several CPU_LIGHT jobs in parallel.
 */
export class ResourceScheduler {
  private readonly semaphores: Record<ResourceClass, Semaphore>;

  constructor(limits: Record<ResourceClass, number>) {
    this.semaphores = {
      CPU_LIGHT: { limit: limits.CPU_LIGHT, active: 0, queue: [] },
      CPU_HEAVY: { limit: limits.CPU_HEAVY, active: 0, queue: [] },
      GPU: { limit: limits.GPU, active: 0, queue: [] },
      IO: { limit: limits.IO, active: 0, queue: [] },
      RENDER: { limit: limits.RENDER, active: 0, queue: [] },
    };
  }

  private async acquire(resourceClass: ResourceClass): Promise<() => void> {
    const semaphore = this.semaphores[resourceClass];
    if (semaphore.active >= semaphore.limit) {
      await new Promise<void>((resolve) => semaphore.queue.push(resolve));
    }
    semaphore.active += 1;
    return () => this.release(resourceClass);
  }

  private release(resourceClass: ResourceClass): void {
    const semaphore = this.semaphores[resourceClass];
    semaphore.active -= 1;
    const next = semaphore.queue.shift();
    if (next) next();
  }

  /** Runs `fn` while holding a slot of the given class, always releasing it. */
  async withSlot<T>(resourceClass: ResourceClass, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(resourceClass);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  available(resourceClass: ResourceClass): number {
    const semaphore = this.semaphores[resourceClass];
    return semaphore.limit - semaphore.active;
  }
}

export function createResourceScheduler(limits: Record<ResourceClass, number>): ResourceScheduler {
  return new ResourceScheduler(limits);
}
