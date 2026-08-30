import type { TranscriptSegment as TranscriptSegmentInput } from '@memetize/contracts';
import {
  type Database,
  type NewTranscriptSegmentRow,
  type TranscriptSegmentRow,
  transcriptSegments,
} from '@memetize/database';
import { assertIntegerMs, segmentId } from '@memetize/shared';
import { and, asc, eq } from 'drizzle-orm';

export interface ReplaceTranscriptParams {
  assetId: string;
  model: string;
  modelVersion: string;
  segments: TranscriptSegmentInput[];
}

/**
 * Pure builder, mirrors `toSceneRows`: turns transcript segments into rows,
 * enforcing integer milliseconds (spec section 4.4).
 */
export function toTranscriptRows(params: ReplaceTranscriptParams): NewTranscriptSegmentRow[] {
  return params.segments.map((segment) => ({
    id: segmentId(),
    assetId: params.assetId,
    startMs: assertIntegerMs(segment.startMs, 'startMs'),
    endMs: assertIntegerMs(segment.endMs, 'endMs'),
    text: segment.text,
    words: segment.words,
    model: params.model,
    modelVersion: params.modelVersion,
  }));
}

/**
 * Idempotently persists a transcript: existing segments for that asset/model
 * combination are replaced (spec section 4.2). An empty segment list (silent
 * or non-verbal clips) is a valid, successful result, not a failure.
 */
export async function replaceTranscript(
  db: Database,
  params: ReplaceTranscriptParams,
): Promise<TranscriptSegmentRow[]> {
  const rows = toTranscriptRows(params);
  return db.transaction(async (tx) => {
    await tx
      .delete(transcriptSegments)
      .where(
        and(
          eq(transcriptSegments.assetId, params.assetId),
          eq(transcriptSegments.model, params.model),
          eq(transcriptSegments.modelVersion, params.modelVersion),
        ),
      );
    if (rows.length === 0) return [];
    return tx.insert(transcriptSegments).values(rows).returning();
  });
}

export function listTranscriptSegments(
  db: Database,
  assetId: string,
): Promise<TranscriptSegmentRow[]> {
  return db.query.transcriptSegments.findMany({
    where: eq(transcriptSegments.assetId, assetId),
    orderBy: asc(transcriptSegments.startMs),
  });
}
