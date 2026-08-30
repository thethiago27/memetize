import { describe, expect, it } from 'vitest';
import { sampleFrameTimestamps } from './sample';

describe('sampleFrameTimestamps', () => {
  it('samples 5 proportional anchors for a short scene, keeping the last one before endMs', () => {
    const timestamps = sampleFrameTimestamps({ startMs: 1000, endMs: 3000 });
    expect(timestamps).toEqual([1000, 1500, 2000, 2500, 2999]);
  });

  it('adds dense samples every intervalMs for scenes over the threshold', () => {
    const timestamps = sampleFrameTimestamps(
      { startMs: 0, endMs: 5000 },
      { intervalMs: 1000, maxFrames: 20 },
    );
    expect(timestamps).toEqual([0, 1000, 1250, 2000, 2500, 3000, 3750, 4000, 4999]);
  });

  it('never exceeds maxFrames even when dense sampling would add more', () => {
    const timestamps = sampleFrameTimestamps(
      { startMs: 0, endMs: 20_000 },
      { intervalMs: 500, maxFrames: 8 },
    );
    expect(timestamps.length).toBeLessThanOrEqual(8);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it('only emits integer millisecond timestamps', () => {
    const timestamps = sampleFrameTimestamps({ startMs: 333, endMs: 1777 });
    for (const t of timestamps) {
      expect(Number.isInteger(t)).toBe(true);
    }
  });

  it('degenerates to a single frame for a zero-length scene', () => {
    expect(sampleFrameTimestamps({ startMs: 500, endMs: 500 })).toEqual([500]);
  });
});
