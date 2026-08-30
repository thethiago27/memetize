/**
 * Integer-millisecond helpers. Time is never stored as a float (spec section
 * 4.4); every duration/offset in the system is an integer number of ms.
 */

export function assertIntegerMs(value: number, label = 'value'): number {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer number of milliseconds, got ${value}`);
  }
  return value;
}

export function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/** Frame rate stored as milli-fps (30fps -> 30000, 29.97fps -> 29970). */
export function fpsToMilli(fps: number): number {
  return Math.round(fps * 1000);
}
