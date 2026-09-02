import {
  type Database,
  type FeedbackEventRow,
  feedbackEvents,
  moments as momentsTable,
} from '@memetize/database';
import { and, asc, inArray } from 'drizzle-orm';
import { applyRangeEvent, type ExcludedRange, overlapsRange } from './aggregate';
import { recordFeedbackEvents } from './events';
import type { FeedbackEventLike } from './types';

export interface ActiveBans {
  /** Directly banned moments plus every moment touching an excluded range. */
  momentIds: Set<string>;
  assetIds: Set<string>;
  excludedRanges: Map<string, ExcludedRange[]>;
}

const BAN_KINDS = [
  'BAN_MOMENT',
  'UNBAN_MOMENT',
  'BAN_ASSET',
  'UNBAN_ASSET',
  'EXCLUDE_RANGE',
  'INCLUDE_RANGE',
] as const;

/**
 * The latest BAN/UNBAN event per id wins. `events` must be in chronological
 * order (the repository returns them that way); later rows overwrite.
 */
export function resolveBans(events: readonly FeedbackEventLike[]): ActiveBans {
  const momentIds = new Set<string>();
  const assetIds = new Set<string>();
  const excludedRanges = new Map<string, ExcludedRange[]>();
  for (const event of events) {
    switch (event.kind) {
      case 'EXCLUDE_RANGE':
      case 'INCLUDE_RANGE':
        applyRangeEvent(excludedRanges, event);
        break;
      case 'BAN_MOMENT':
        if (event.momentId) momentIds.add(event.momentId);
        break;
      case 'UNBAN_MOMENT':
        if (event.momentId) momentIds.delete(event.momentId);
        break;
      case 'BAN_ASSET':
        if (event.assetId) assetIds.add(event.assetId);
        break;
      case 'UNBAN_ASSET':
        if (event.assetId) assetIds.delete(event.assetId);
        break;
      default:
        break;
    }
  }
  return { momentIds, assetIds, excludedRanges };
}

/**
 * Bans in force right now. Range exclusions are resolved against the
 * catalog here, so a moment created by a later reprocess is still excluded
 * if it touches an excluded range.
 */
export async function listActiveBans(db: Database): Promise<ActiveBans> {
  const rows = await db.query.feedbackEvents.findMany({
    where: inArray(feedbackEvents.kind, [...BAN_KINDS]),
    orderBy: [asc(feedbackEvents.createdAt), asc(feedbackEvents.seq)],
  });
  const bans = resolveBans(rows);
  const assetIds = [...bans.excludedRanges.keys()];
  if (assetIds.length === 0) return bans;
  const candidates = await db.query.moments.findMany({
    where: and(inArray(momentsTable.assetId, assetIds)),
    columns: { id: true, assetId: true, startMs: true, endMs: true },
  });
  for (const moment of candidates) {
    const ranges = bans.excludedRanges.get(moment.assetId) ?? [];
    if (ranges.some((range) => overlapsRange(moment, range))) bans.momentIds.add(moment.id);
  }
  return bans;
}

export function excludeRange(
  db: Database,
  params: { assetId: string; startMs: number; endMs: number; note?: string | null },
): Promise<FeedbackEventRow> {
  return recordOne(db, {
    kind: 'EXCLUDE_RANGE',
    assetId: params.assetId,
    note: params.note ?? null,
    context: { startMs: params.startMs, endMs: params.endMs },
  });
}

export function includeRange(
  db: Database,
  params: { assetId: string; startMs: number; endMs: number },
): Promise<FeedbackEventRow> {
  return recordOne(db, {
    kind: 'INCLUDE_RANGE',
    assetId: params.assetId,
    context: { startMs: params.startMs, endMs: params.endMs },
  });
}

export function banMoment(
  db: Database,
  params: { momentId: string; assetId: string; note?: string | null },
): Promise<FeedbackEventRow> {
  return recordOne(db, {
    kind: 'BAN_MOMENT',
    momentId: params.momentId,
    assetId: params.assetId,
    note: params.note ?? null,
  });
}

export function unbanMoment(
  db: Database,
  params: { momentId: string; assetId: string },
): Promise<FeedbackEventRow> {
  return recordOne(db, {
    kind: 'UNBAN_MOMENT',
    momentId: params.momentId,
    assetId: params.assetId,
  });
}

export function banAsset(
  db: Database,
  params: { assetId: string; note?: string | null },
): Promise<FeedbackEventRow> {
  return recordOne(db, { kind: 'BAN_ASSET', assetId: params.assetId, note: params.note ?? null });
}

export function unbanAsset(db: Database, params: { assetId: string }): Promise<FeedbackEventRow> {
  return recordOne(db, { kind: 'UNBAN_ASSET', assetId: params.assetId });
}

async function recordOne(
  db: Database,
  input: Omit<Parameters<typeof recordFeedbackEvents>[1][number], 'source'>,
): Promise<FeedbackEventRow> {
  const [row] = await recordFeedbackEvents(db, [{ ...input, source: 'USER' }]);
  if (!row) throw new Error('failed to record feedback event');
  return row;
}
