import { type Database, type FeedbackEventRow, feedbackEvents } from '@memetize/database';
import { asc, inArray } from 'drizzle-orm';
import { recordFeedbackEvents } from './events';
import type { FeedbackEventLike } from './types';

export interface ActiveBans {
  momentIds: Set<string>;
  assetIds: Set<string>;
}

const BAN_KINDS = ['BAN_MOMENT', 'UNBAN_MOMENT', 'BAN_ASSET', 'UNBAN_ASSET'] as const;

/**
 * The latest BAN/UNBAN event per id wins. `events` must be in chronological
 * order (the repository returns them that way); later rows overwrite.
 */
export function resolveBans(events: readonly FeedbackEventLike[]): ActiveBans {
  const momentIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const event of events) {
    switch (event.kind) {
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
  return { momentIds, assetIds };
}

export async function listActiveBans(db: Database): Promise<ActiveBans> {
  const rows = await db.query.feedbackEvents.findMany({
    where: inArray(feedbackEvents.kind, [...BAN_KINDS]),
    orderBy: [asc(feedbackEvents.createdAt), asc(feedbackEvents.seq)],
  });
  return resolveBans(rows);
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
