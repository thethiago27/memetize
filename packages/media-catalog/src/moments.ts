import type { MomentCandidate } from '@memetize/contracts';
import {
  type Executor,
  type MomentRow,
  momentIdentities,
  moments,
  type NewMomentRow,
} from '@memetize/database';
import { assertIntegerMs, momentId } from '@memetize/shared';
import { asc, eq } from 'drizzle-orm';

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

/** Stable identity for a moment within an asset: the exact editorial interval. */
function intervalKey(startMs: number, endMs: number): string {
  return `${startMs}:${endMs}`;
}

/**
 * Idempotently persists the asset's moments: the asset's current moments are
 * replaced wholesale by this extraction, so re-running never duplicates moments
 * and rows from a previous extractor/model never linger next to the new ones
 * (spec section 4.2).
 *
 * Identity is editorial, not per-extraction (F12): each exact source interval of
 * an asset owns one moment id for good, recorded in `moment_identities`. A
 * re-extraction that produces the same interval — with the same extractor, a
 * new version, or a different provider — reuses that id, so bans, swaps,
 * feedback vectors and usage stats keyed by momentId keep pointing at the same
 * material; an interval that disappears and later comes back regains its id.
 * Intervals never seen before get fresh ids. Boundaries that changed are new
 * moments: no feedback is transferred by overlap, because overlap alone does not
 * prove the two express the same thing.
 */
export async function replaceMoments(
  db: Executor,
  params: ReplaceMomentsParams,
): Promise<MomentRow[]> {
  const rows = toMomentRows(params);
  return db.transaction(async (tx) => {
    const known = await tx.query.momentIdentities.findMany({
      where: eq(momentIdentities.assetId, params.assetId),
    });
    const idByInterval = new Map(
      known.map((identity) => [intervalKey(identity.startMs, identity.endMs), identity.momentId]),
    );
    const seen = new Set<string>();
    const withIdentity: NewMomentRow[] = [];
    for (const row of rows) {
      const key = intervalKey(row.startMs, row.endMs);
      // Two candidates for the same interval collapse onto one moment.
      if (seen.has(key)) continue;
      seen.add(key);
      const stableId = idByInterval.get(key);
      withIdentity.push(stableId ? { ...row, id: stableId } : row);
    }

    const fresh = withIdentity.filter(
      (row) => !idByInterval.has(intervalKey(row.startMs, row.endMs)),
    );
    if (fresh.length > 0) {
      await tx
        .insert(momentIdentities)
        .values(
          fresh.map((row) => ({
            assetId: params.assetId,
            startMs: row.startMs,
            endMs: row.endMs,
            momentId: row.id as string,
          })),
        )
        .onConflictDoNothing();
    }

    await tx.delete(moments).where(eq(moments.assetId, params.assetId));
    if (withIdentity.length === 0) return [];
    return tx.insert(moments).values(withIdentity).returning();
  });
}

export function listMoments(db: Executor, assetId: string): Promise<MomentRow[]> {
  return db.query.moments.findMany({
    where: eq(moments.assetId, assetId),
    orderBy: asc(moments.startMs),
  });
}

export function getMoment(db: Executor, id: string): Promise<MomentRow | undefined> {
  return db.query.moments.findFirst({ where: eq(moments.id, id) });
}
