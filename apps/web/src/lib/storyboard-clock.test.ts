import { describe, expect, it } from 'vitest';
import { outputToSourceMs, sourceToOutputMs } from './storyboard-clock';

describe('storyboard clock', () => {
  const audio = { timelineStartMs: 0, sourceStartMs: 30_000 };

  it('maps output time onto the song', () => {
    expect(outputToSourceMs(0, audio)).toBe(30_000);
    expect(outputToSourceMs(12_400, audio)).toBe(42_400);
  });

  it('maps song time back to output', () => {
    expect(sourceToOutputMs(30_000, audio)).toBe(0);
    expect(sourceToOutputMs(42_400, audio)).toBe(12_400);
  });

  it('honors a non-zero timeline start', () => {
    const offset = { timelineStartMs: 2_000, sourceStartMs: 30_000 };
    expect(outputToSourceMs(2_000, offset)).toBe(30_000);
    expect(sourceToOutputMs(30_000, offset)).toBe(2_000);
    expect(sourceToOutputMs(outputToSourceMs(7_777, offset), offset)).toBe(7_777);
  });
});
