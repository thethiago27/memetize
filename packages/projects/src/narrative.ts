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
    sourceKind: segment.sourceKind,
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

/** Stable identity for a segment within a project: its exact interval + kind. */
function segmentKey(startMs: number, endMs: number, sourceKind: string): string {
  return `${startMs}:${endMs}:${sourceKind}`;
}

/**
 * Idempotently persists narrative segments: existing rows for the project
 * are replaced wholesale (spec section 4.2), mirroring `replaceMoments`.
 *
 * A re-run that reproduces the exact same segment interval reuses that segment's
 * id (F12), so strict rejections keyed by `projectId:segmentId` survive
 * reprocessing; only segments whose boundaries changed get fresh ids.
 */
export async function replaceNarrativeSegments(
  db: Database,
  params: ReplaceNarrativeSegmentsParams,
): Promise<NarrativeSegmentRow[]> {
  const rows = toNarrativeSegmentRows(params);
  return db.transaction(async (tx) => {
    const existing = await tx.query.narrativeSegments.findMany({
      where: eq(narrativeSegments.projectId, params.projectId),
    });
    const idByInterval = new Map(
      existing.map((segment) => [
        segmentKey(segment.startMs, segment.endMs, segment.sourceKind),
        segment.id,
      ]),
    );
    const preserved = rows.map((row) => {
      const stableId = idByInterval.get(
        segmentKey(row.startMs, row.endMs, row.sourceKind ?? 'LYRIC'),
      );
      return stableId ? { ...row, id: stableId } : row;
    });

    await tx.delete(narrativeSegments).where(eq(narrativeSegments.projectId, params.projectId));
    if (preserved.length === 0) return [];
    return tx.insert(narrativeSegments).values(preserved).returning();
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
