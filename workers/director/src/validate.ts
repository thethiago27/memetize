import type { DirectorPick } from '@memetize/contracts';

/** Thrown for any pick that breaks the Director's contract with `MATCH` (spec section 54). */
export class DirectorInvalidPickError extends Error {}

/**
 * Validates the LLM's picks against each segment's own shortlist before
 * `assembleTimeline` ever runs (spec section 54): a live provider must
 * never smuggle in a moment it wasn't shown, a segment can be skipped
 * (no pick) but never double-picked, and a pick against a segment with an
 * empty shortlist is always a bug.
 */
export function validatePicks(
  picks: readonly DirectorPick[],
  shortlistBySegment: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const pickedSegments = new Set<string>();
  for (const pick of picks) {
    const shortlist = shortlistBySegment.get(pick.segmentId);
    if (!shortlist) {
      throw new DirectorInvalidPickError(`pick references unknown segment "${pick.segmentId}"`);
    }
    if (shortlist.size === 0) {
      throw new DirectorInvalidPickError(
        `segment "${pick.segmentId}" has an empty shortlist but received a pick`,
      );
    }
    if (!shortlist.has(pick.momentId)) {
      throw new DirectorInvalidPickError(
        `moment "${pick.momentId}" is not in the shortlist of segment "${pick.segmentId}"`,
      );
    }
    if (pickedSegments.has(pick.segmentId)) {
      throw new DirectorInvalidPickError(`segment "${pick.segmentId}" received more than one pick`);
    }
    pickedSegments.add(pick.segmentId);
  }
}
