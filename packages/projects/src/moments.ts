import {
  mediaAssets as assetsTable,
  type Database,
  moments as momentsTable,
  scenes as scenesTable,
} from '@memetize/database';
import { inArray } from 'drizzle-orm';

/** What the Studio needs to show a moment as a human-readable card. */
export interface MomentSummary {
  id: string;
  assetId: string;
  assetFilename: string;
  description: string;
  primaryEmotion: string | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Scene frame nearest the moment start, else the asset thumbnail, else null. */
  thumbnailPath: string | null;
}

/**
 * Read-only projection for the editor (studio-redesign spec): resolves the
 * moments a project references (timeline clips, shortlists) into
 * descriptions, asset names, and the closest extracted frame.
 */
export async function summarizeMoments(
  db: Database,
  momentIds: Iterable<string>,
): Promise<Record<string, MomentSummary>> {
  const ids = [...new Set(momentIds)];
  if (ids.length === 0) return {};

  const momentRows = await db.query.moments.findMany({ where: inArray(momentsTable.id, ids) });
  const sceneIds = [...new Set(momentRows.map((row) => row.sceneId))];
  const assetIds = [...new Set(momentRows.map((row) => row.assetId))];
  const [sceneRows, assetRows] = await Promise.all([
    sceneIds.length > 0
      ? db.query.scenes.findMany({ where: inArray(scenesTable.id, sceneIds) })
      : Promise.resolve([]),
    assetIds.length > 0
      ? db.query.mediaAssets.findMany({ where: inArray(assetsTable.id, assetIds) })
      : Promise.resolve([]),
  ]);
  const sceneById = new Map(sceneRows.map((row) => [row.id, row]));
  const assetById = new Map(assetRows.map((row) => [row.id, row]));

  const summaries: Record<string, MomentSummary> = {};
  for (const moment of momentRows) {
    const scene = sceneById.get(moment.sceneId);
    const asset = assetById.get(moment.assetId);
    let nearest: { path: string; distance: number } | null = null;
    for (const frame of scene?.frames ?? []) {
      const distance = Math.abs(frame.timestampMs - moment.startMs);
      if (!nearest || distance < nearest.distance) nearest = { path: frame.path, distance };
    }
    summaries[moment.id] = {
      id: moment.id,
      assetId: moment.assetId,
      assetFilename: asset?.filename ?? moment.assetId,
      description: moment.description,
      primaryEmotion: moment.primaryEmotion,
      startMs: moment.startMs,
      endMs: moment.endMs,
      durationMs: moment.durationMs,
      thumbnailPath: nearest?.path ?? asset?.thumbnailPath ?? null,
    };
  }
  return summaries;
}
