import type { ResourceClass } from '@memetize/contracts';
import { describe, expect, it } from 'vitest';
import { ResourceScheduler } from './scheduler';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const limits: Record<ResourceClass, number> = {
  CPU_LIGHT: 4,
  CPU_HEAVY: 1,
  GPU: 1,
  IO: 4,
  RENDER: 1,
};

describe('ResourceScheduler', () => {
  it('runs one CPU_HEAVY job at a time', async () => {
    const scheduler = new ResourceScheduler(limits);
    let active = 0;
    let peak = 0;
    const task = (): Promise<void> =>
      scheduler.withSlot('CPU_HEAVY', async () => {
        active += 1;
        peak = Math.max(peak, active);
        await delay(15);
        active -= 1;
      });
    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(1);
  });

  it('allows CPU_LIGHT up to its limit', async () => {
    const scheduler = new ResourceScheduler(limits);
    let active = 0;
    let peak = 0;
    const task = (): Promise<void> =>
      scheduler.withSlot('CPU_LIGHT', async () => {
        active += 1;
        peak = Math.max(peak, active);
        await delay(15);
        active -= 1;
      });
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBe(4);
  });

  it('releases the slot even when the task throws', async () => {
    const scheduler = new ResourceScheduler(limits);
    await expect(
      scheduler.withSlot('RENDER', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(scheduler.available('RENDER')).toBe(1);
  });
});
