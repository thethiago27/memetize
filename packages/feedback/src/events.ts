import type { FeedbackKind } from '@memetize/contracts';
import {
  type Database,
  type FeedbackEventRow,
  feedbackEvents,
  type NewFeedbackEventRow,
} from '@memetize/database';
import { feedbackEventId } from '@memetize/shared';
import { and, asc, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { FeedbackEventInput } from './types';

export function toFeedbackEventRows(inputs: readonly FeedbackEventInput[]): NewFeedbackEventRow[] {
  return inputs.map((input) => ({
    id: feedbackEventId(),
    projectId: input.projectId ?? null,
    timelineVersion: input.timelineVersion ?? null,
    clipId: input.clipId ?? null,
    segmentId: input.segmentId ?? null,
    momentId: input.momentId ?? null,
    assetId: input.assetId ?? null,
    kind: input.kind,
    value: input.value ?? null,
    note: input.note ?? null,
    context: input.context ?? {},
    source: input.source,
  }));
}

/** Append-only insert; returns rows in input order. */
export async function recordFeedbackEvents(
  db: Database,
  inputs: readonly FeedbackEventInput[],
): Promise<FeedbackEventRow[]> {
  const rows = toFeedbackEventRows(inputs);
  if (rows.length === 0) return [];
  const inserted = await db.insert(feedbackEvents).values(rows).returning();
  const byId = new Map(inserted.map((row) => [row.id, row]));
  return rows.map((row) => {
    const persisted = byId.get(row.id);
    if (!persisted) throw new Error('failed to insert feedback event');
    return persisted;
  });
}

export interface FeedbackFilter {
  /** Restrict to one project; global notes (null project, kind NOTE) are
   * included as well unless `includeGlobalNotes` is false. */
  projectId?: string;
  includeGlobalNotes?: boolean;
  momentId?: string;
  kinds?: readonly FeedbackKind[];
  /** Chronological by default (what aggregation needs); `desc` for listings. */
  order?: 'asc' | 'desc';
  limit?: number;
}

export async function listFeedbackEvents(
  db: Database,
  filter: FeedbackFilter = {},
): Promise<FeedbackEventRow[]> {
  const conditions: SQL[] = [];
  if (filter.projectId) {
    const own = eq(feedbackEvents.projectId, filter.projectId);
    const globalNotes = and(isNull(feedbackEvents.projectId), eq(feedbackEvents.kind, 'NOTE'));
    const scoped = filter.includeGlobalNotes === false ? own : or(own, globalNotes);
    if (scoped) conditions.push(scoped);
  }
  if (filter.momentId) conditions.push(eq(feedbackEvents.momentId, filter.momentId));
  if (filter.kinds && filter.kinds.length > 0) {
    conditions.push(inArray(feedbackEvents.kind, [...filter.kinds]));
  }
  const direction = filter.order === 'desc' ? desc : asc;
  return db.query.feedbackEvents.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [direction(feedbackEvents.createdAt), direction(feedbackEvents.seq)],
    ...(filter.limit ? { limit: filter.limit } : {}),
  });
}

export function getFeedbackEvent(db: Database, id: string): Promise<FeedbackEventRow | undefined> {
  return db.query.feedbackEvents.findFirst({ where: eq(feedbackEvents.id, id) });
}
