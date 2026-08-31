import type { ShortlistCandidate } from '@memetize/contracts';
import type { DirectorShortlistEntry } from '@memetize/model-providers';

export interface HydratedMoment {
  description: string;
  durationMs: number;
  primaryEmotion: string | null;
}

/**
 * MATCH shortlists are JSON snapshots. If a catalog asset is deleted later,
 * those moment ids linger. Drop them so the Director never sees (and cannot
 * pick) a moment that `assembleTimeline` can no longer resolve.
 */
export function hydrateShortlist(
  entries: readonly ShortlistCandidate[],
  momentById: ReadonlyMap<string, HydratedMoment>,
): DirectorShortlistEntry[] {
  const shortlist: DirectorShortlistEntry[] = [];
  for (const entry of entries) {
    const moment = momentById.get(entry.momentId);
    if (!moment) continue;
    shortlist.push({
      momentId: entry.momentId,
      assetId: entry.assetId,
      finalScore: entry.finalScore,
      description: moment.description,
      durationMs: moment.durationMs,
      primaryEmotion: moment.primaryEmotion,
    });
  }
  return shortlist;
}
