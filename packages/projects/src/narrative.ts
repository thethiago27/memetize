import type { NarrativeSegment } from '@memetize/contracts';
import {
  type Database,
  type NarrativeSegmentRow,
  type NewNarrativeSegmentRow,
  narrativeSegments,
} from '@memetize/database';
import { assertIntegerMs, narrativeId } from '@memetize/shared';
import { asc, eq } from 'drizzle-orm';

export interface ReplaceNarrativeSegmentsParams {
  projectId: string;
  segments: NarrativeSegment[];
  extractor: string;
  extractorVersion: string;
}

/** Pure builder: enforces integer milliseconds (spec section 4.4). */
export function toNarrativeSegmentRows(
  params: ReplaceNarrativeSegmentsParams,
): NewNarrativeSegmentRow[] {
  return params.segments.map((segment) => ({
    id: narrativeId(),
    projectId: params.projectId,
    startMs: assertIntegerMs(segment.startMs, 'startMs'),
    endMs: assertIntegerMs(segment.endMs, 'endMs'),
    lyrics: segment.lyrics,
    meaning: segment.meaning,
    emotion: segment.emotion,
    narrativeFunction: segment.narrativeFunction,
    visualIdeas: segment.visualIdeas,
    literalness: segment.literalness,
    ironyPotential: segment.ironyPotential,
    energy: segment.energy,
    extractor: params.extractor,
    extractorVersion: params.extractorVersion,
  }));
}

/**
 * Idempotently persists narrative segments: existing rows for the project
 * are replaced wholesale (spec section 4.2), mirroring `replaceMoments`.
 */
export async function replaceNarrativeSegments(
  db: Database,
  params: ReplaceNarrativeSegmentsParams,
): Promise<NarrativeSegmentRow[]> {
  const rows = toNarrativeSegmentRows(params);
  return db.transaction(async (tx) => {
    await tx.delete(narrativeSegments).where(eq(narrativeSegments.projectId, params.projectId));
    if (rows.length === 0) return [];
    return tx.insert(narrativeSegments).values(rows).returning();
  });
}

export function listNarrativeSegments(
  db: Database,
  projectId: string,
): Promise<NarrativeSegmentRow[]> {
  return db.query.narrativeSegments.findMany({
    where: eq(narrativeSegments.projectId, projectId),
    orderBy: asc(narrativeSegments.startMs),
  });
}
