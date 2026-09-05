import type { MomentRow, SegmentMatchRow } from '@memetize/database';
import type { ActiveBans } from '@memetize/feedback';

export interface FilteredCandidates {
  momentRows: MomentRow[];
  momentById: Map<string, MomentRow>;
  matches: SegmentMatchRow[];
}

/**
 * Removes banned moments from the Director's candidate universe (F13). A moment
 * is dropped when it is directly banned, its asset is banned, or it falls in an
 * excluded range — `listActiveBans` already folds all three into `momentIds`.
 * Both the moment lookup and every segment's shortlist/ranked lists are filtered,
 * so the shortlist the LLM picks from and the coverage fallback both see only
 * eligible candidates.
 */
export function filterBannedCandidates(
  momentRows: readonly MomentRow[],
  matches: readonly SegmentMatchRow[],
  bans: ActiveBans,
): FilteredCandidates {
  const allowed = momentRows.filter(
    (moment) => !bans.momentIds.has(moment.id) && !bans.assetIds.has(moment.assetId),
  );
  const momentById = new Map(allowed.map((moment) => [moment.id, moment]));
  const filteredMatches = matches.map((match) => ({
    ...match,
    shortlist: match.shortlist.filter((entry) => momentById.has(entry.momentId)),
    ranked: match.ranked.filter((entry) => momentById.has(entry.momentId)),
  }));
  return { momentRows: allowed, momentById, matches: filteredMatches };
}
