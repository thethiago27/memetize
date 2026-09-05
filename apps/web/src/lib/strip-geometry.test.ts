import { describe, expect, it } from 'vitest';
import { clipAt, formatClock, msToPx, outputDownbeats, pxToMs, rulerTicks } from './strip-geometry';

const clips = [
  { id: 'a', timeline: { startMs: 0, endMs: 2_000 } },
  { id: 'b', timeline: { startMs: 2_000, endMs: 5_000 } },
  { id: 'c', timeline: { startMs: 5_000, endMs: 6_000 } },
];

describe('msToPx / pxToMs', () => {
  it('round-trips through the strip width', () => {
    expect(msToPx(30_000, 60_000, 1200)).toBe(600);
    expect(pxToMs(600, 60_000, 1200)).toBe(30_000);
    expect(pxToMs(msToPx(12_345, 60_000, 987), 60_000, 987)).toBe(12_345);
  });

  it('clamps pointer positions to the timeline and tolerates zero sizes', () => {
    expect(pxToMs(-40, 60_000, 1200)).toBe(0);
    expect(pxToMs(5_000, 60_000, 1200)).toBe(60_000);
    expect(msToPx(1_000, 0, 1200)).toBe(0);
    expect(pxToMs(100, 60_000, 0)).toBe(0);
  });
});

describe('rulerTicks', () => {
  it('ticks every 5 s and labels every 10 s when there is room', () => {
    const ticks = rulerTicks(60_000, 1200);
    expect(ticks.map((tick) => tick.ms)).toEqual([
      0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000, 55_000,
      60_000,
    ]);
    expect(ticks.filter((tick) => tick.label).map((tick) => tick.ms)).toEqual([
      0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000,
    ]);
  });

  it('labels every 20 s when 10 s would be narrower than 56px', () => {
    const ticks = rulerTicks(60_000, 300);
    expect(ticks.filter((tick) => tick.label).map((tick) => tick.ms)).toEqual([
      0, 20_000, 40_000, 60_000,
    ]);
  });

  it('is empty without a duration', () => {
    expect(rulerTicks(0, 1200)).toEqual([]);
  });
});

describe('clipAt', () => {
  it('finds the clip by half-open range', () => {
    expect(clipAt(clips, 0)?.id).toBe('a');
    expect(clipAt(clips, 1_999)?.id).toBe('a');
    expect(clipAt(clips, 2_000)?.id).toBe('b');
  });

  it('answers the last clip at and past the end', () => {
    expect(clipAt(clips, 6_000)?.id).toBe('c');
    expect(clipAt(clips, 9_000)?.id).toBe('c');
  });

  it('is null before the first clip and on an empty strip', () => {
    expect(clipAt([{ timeline: { startMs: 500, endMs: 900 } }], 100)).toBeNull();
    expect(clipAt([], 0)).toBeNull();
  });
});

describe('outputDownbeats', () => {
  const window = { sourceStartMs: 30_000, sourceEndMs: 90_000 };

  it('keeps downbeats inside the window on the output clock', () => {
    expect(outputDownbeats([29_000, 30_000, 45_500, 90_000, 91_000], window, 60_000)).toEqual([
      0, 15_500, 60_000,
    ]);
  });

  it('drops downbeats past the output duration and answers nothing without a window', () => {
    expect(outputDownbeats([30_000, 80_000], window, 40_000)).toEqual([0]);
    expect(outputDownbeats([30_000], null, 60_000)).toEqual([]);
  });
});

describe('formatClock', () => {
  it('shows minutes, seconds and tenths', () => {
    expect(formatClock(0)).toBe('00:00.0');
    expect(formatClock(12_460)).toBe('00:12.4');
    expect(formatClock(65_999)).toBe('01:05.9');
    expect(formatClock(-5)).toBe('00:00.0');
  });
});
