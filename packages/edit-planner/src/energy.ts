import type { EnergyPoint } from '@memetize/contracts';

/**
 * The energy curve's value nearest `timeMs`, or null when the curve is empty.
 *
 * The curve is a sparse sampling, so "nearest" is the only meaningful lookup —
 * and the only one both the window selector and the coverage planner need. They
 * each had their own copy, differing only in what an empty curve returns.
 */
export function nearestEnergy(timeMs: number, energyCurve: readonly EnergyPoint[]): number | null {
  let best: EnergyPoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of energyCurve) {
    const distance = Math.abs(point.timeMs - timeMs);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best?.value ?? null;
}
