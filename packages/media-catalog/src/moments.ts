import type { MomentCandidate } from '@memetize/contracts';
import { type Database, type MomentRow, moments, type NewMomentRow } from '@memetize/database';
import { assertIntegerMs, momentId } from '@memetize/shared';
import { and, asc, eq } from 'drizzle-orm';

export interface ReplaceMomentsParams {
  assetId: string;
  extractor: string;
  extractorVersion: string;
  moments: MomentCandidate[];
}

/** Pure builder, mirrors `toSceneRows` (spec section 21). */
export function toMomentRows(params: ReplaceMomentsParams): NewMomentRow[] {
  return params.moments.map((moment) => {
    const startMs = assertIntegerMs(moment.startMs, 'startMs');
    const endMs = assertIntegerMs(moment.endMs, 'endMs');
    return {
      id: momentId(),
      sceneId: moment.sceneId,
      assetId: params.assetId,
      startMs,
      endMs,
      durationMs: assertIntegerMs(endMs - startMs, 'durationMs'),
      description: moment.description,
      primaryEmotion: moment.primaryEmotion,
      emotionIntensity: moment.emotionIntensity,
      visualEnergy: moment.visualEnergy,
      qualityScore: moment.qualityScore,
      metadata: moment.metadata,
      extractor: params.extractor,
      extractorVersion: params.extractorVersion,
    };
  });
}

/**
 * Idempotently persists moments: existing rows for that asset/extractor
 * combination are replaced, so re-running extraction never duplicates
 * moments (spec section 4.2).
 */
export async function replaceMoments(
  db: Database,
  params: ReplaceMomentsParams,
): Promise<MomentRow[]> {
  const rows = toMomentRows(params);
  return db.transaction(async (tx) => {
    await tx
      .delete(moments)
      .where(
        and(
          eq(moments.assetId, params.assetId),
          eq(moments.extractor, params.extractor),
          eq(moments.extractorVersion, params.extractorVersion),
        ),
      );
    if (rows.length === 0) return [];
    return tx.insert(moments).values(rows).returning();
  });
}

export function listMoments(db: Database, assetId: string): Promise<MomentRow[]> {
  return db.query.moments.findMany({
    where: eq(moments.assetId, assetId),
    orderBy: asc(moments.startMs),
  });
}

export function getMoment(db: Database, id: string): Promise<MomentRow | undefined> {
  return db.query.moments.findFirst({ where: eq(moments.id, id) });
}
