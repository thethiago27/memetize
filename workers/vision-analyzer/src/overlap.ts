export interface Interval {
  startMs: number;
  endMs: number;
}

/** True when two half-open `[startMs, endMs)` intervals share any time. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}
