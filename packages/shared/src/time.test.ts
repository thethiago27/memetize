import { describe, expect, it } from 'vitest';
import { assertIntegerMs, fpsToMilli, secondsToMs } from './time';

describe('time', () => {
  it('converts seconds to integer ms', () => {
    expect(secondsToMs(3.2)).toBe(3200);
    expect(secondsToMs(1 / 3)).toBe(333);
  });

  it('rejects non-integer ms but passes integers through', () => {
    expect(() => assertIntegerMs(3.5)).toThrow(TypeError);
    expect(assertIntegerMs(3200)).toBe(3200);
  });

  it('converts fps to milli-fps', () => {
    expect(fpsToMilli(30)).toBe(30000);
    expect(fpsToMilli(29.97)).toBe(29970);
  });
});
