import type { FeedbackEventLike } from './types';

export { smoothedRate } from '@memetize/clip-ranker';

export interface FunctionStats {
  wins: number;
  losses: number;
}

/** Per-moment memory the ranker consumes (editorial-memory spec). */
export interface MomentUsageStats {
  wins: number;
  losses: number;
  byFunction: Map<string, FunctionStats>;
  /** Projects whose finished timeline (PLACED) or editor swap (SWAP_IN) used the moment. */
  projects: Set<string>;
}

export interface ExcludedRange {
  startMs: number;
  endMs: number;
}

export interface FeedbackAggregate {
  usage: Map<string, MomentUsageStats>;
  /** Direct bans only; range exclusions need the catalog to resolve to moments (`listActiveBans`). */
  bans: { momentIds: Set<string>; assetIds: Set<string> };
  /** assetId → excluded source ranges still in force. */
  excludedRanges: Map<string, ExcludedRange[]>;
  /** `rejectionKey(projectId, segmentId)` → moments the editor swapped out of that slot. */
  rejectedBySegment: Map<string, Set<string>>;
  /** Newest `createdAt` considered, null when no event was. */
  cutoffAt: Date | null;
  eventCount: number;
}

export interface AggregateOptions {
  /** Only events strictly before this instant count (evaluation leave-one-out). */
  before?: Date;
}

export const RATING_WIN_MIN = 4;
export const RATING_LOSS_MAX = 2;

export function rejectionKey(projectId: string, segmentId: string): string {
  return `${projectId}:${segmentId}`;
}

export function emptyUsage(): MomentUsageStats {
  return { wins: 0, losses: 0, byFunction: new Map(), projects: new Set() };
}

function usageFor(aggregate: FeedbackAggregate, momentId: string): MomentUsageStats {
  let stats = aggregate.usage.get(momentId);
  if (!stats) {
    stats = emptyUsage();
    aggregate.usage.set(momentId, stats);
  }
  return stats;
}

function tally(stats: MomentUsageStats, narrativeFunction: string | undefined, win: boolean) {
  if (win) stats.wins += 1;
  else stats.losses += 1;
  const fn = (narrativeFunction ?? '').trim().toLowerCase();
  if (!fn) return;
  const bucket = stats.byFunction.get(fn) ?? { wins: 0, losses: 0 };
  if (win) bucket.wins += 1;
  else bucket.losses += 1;
  stats.byFunction.set(fn, bucket);
}

/**
 * Pure fold over feedback events (any order). SWAP_IN / CLIP_UP are wins,
 * SWAP_OUT / CLIP_DOWN are losses, a VIDEO_RATING of 4+ or 2- spreads a win
 * or loss over every placement it snapshotted, PLACED and SWAP_IN record
 * project usage, and the latest BAN/UNBAN per id decides the ban sets.
 */
export function aggregateFeedback(
  events: readonly FeedbackEventLike[],
  options: AggregateOptions = {},
): FeedbackAggregate {
  const aggregate: FeedbackAggregate = {
    usage: new Map(),
    bans: { momentIds: new Set(), assetIds: new Set() },
    excludedRanges: new Map(),
    rejectedBySegment: new Map(),
    cutoffAt: null,
    eventCount: 0,
  };

  const ordered = [...events]
    .filter((event) => !options.before || event.createdAt.getTime() < options.before.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.seq - b.seq);

  for (const event of ordered) {
    aggregate.eventCount += 1;
    if (!aggregate.cutoffAt || event.createdAt > aggregate.cutoffAt) {
      aggregate.cutoffAt = event.createdAt;
    }
    const fn = event.context.narrativeFunction;
    switch (event.kind) {
      case 'SWAP_IN':
        if (!event.momentId) break;
        tally(usageFor(aggregate, event.momentId), fn, true);
        if (event.projectId) usageFor(aggregate, event.momentId).projects.add(event.projectId);
        break;
      case 'CLIP_UP':
        if (event.momentId) tally(usageFor(aggregate, event.momentId), fn, true);
        break;
      case 'SWAP_OUT':
        if (!event.momentId) break;
        tally(usageFor(aggregate, event.momentId), fn, false);
        if (event.projectId && event.segmentId) {
          const key = rejectionKey(event.projectId, event.segmentId);
          const set = aggregate.rejectedBySegment.get(key) ?? new Set<string>();
          set.add(event.momentId);
          aggregate.rejectedBySegment.set(key, set);
        }
        break;
      case 'CLIP_DOWN':
        if (event.momentId) tally(usageFor(aggregate, event.momentId), fn, false);
        break;
      case 'VIDEO_RATING': {
        const value = event.value ?? 0;
        const win = value >= RATING_WIN_MIN;
        const loss = value > 0 && value <= RATING_LOSS_MAX;
        if (!win && !loss) break;
        for (const placement of event.context.placements ?? []) {
          tally(usageFor(aggregate, placement.momentId), placement.narrativeFunction, win);
        }
        break;
      }
      case 'PLACED':
        if (event.momentId && event.projectId) {
          usageFor(aggregate, event.momentId).projects.add(event.projectId);
        }
        break;
      case 'BAN_MOMENT':
        if (event.momentId) aggregate.bans.momentIds.add(event.momentId);
        break;
      case 'UNBAN_MOMENT':
        if (event.momentId) aggregate.bans.momentIds.delete(event.momentId);
        break;
      case 'BAN_ASSET':
        if (event.assetId) aggregate.bans.assetIds.add(event.assetId);
        break;
      case 'UNBAN_ASSET':
        if (event.assetId) aggregate.bans.assetIds.delete(event.assetId);
        break;
      case 'EXCLUDE_RANGE':
      case 'INCLUDE_RANGE':
        applyRangeEvent(aggregate.excludedRanges, event);
        break;
      case 'NOTE':
        break;
    }
  }

  return aggregate;
}

export function rangeOf(event: FeedbackEventLike): ExcludedRange | null {
  const { startMs, endMs } = event.context;
  if (startMs === undefined || endMs === undefined || endMs <= startMs) return null;
  return { startMs, endMs };
}

/** EXCLUDE adds a range; INCLUDE with the same bounds removes it (latest wins). */
export function applyRangeEvent(
  excludedRanges: Map<string, ExcludedRange[]>,
  event: FeedbackEventLike,
): void {
  const range = rangeOf(event);
  if (!event.assetId || !range) return;
  const current = excludedRanges.get(event.assetId) ?? [];
  const without = current.filter(
    (entry) => entry.startMs !== range.startMs || entry.endMs !== range.endMs,
  );
  if (event.kind === 'EXCLUDE_RANGE') without.push(range);
  if (without.length > 0) excludedRanges.set(event.assetId, without);
  else excludedRanges.delete(event.assetId);
}

export function overlapsRange(
  moment: { startMs: number; endMs: number },
  range: ExcludedRange,
): boolean {
  return moment.startMs < range.endMs && moment.endMs > range.startMs;
}
