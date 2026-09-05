import type { AssetStatus } from '@memetize/contracts';
import { type Executor, type MediaAssetRow, mediaAssets } from '@memetize/database';
import { desc, eq } from 'drizzle-orm';

export function getAsset(db: Executor, id: string): Promise<MediaAssetRow | undefined> {
  return db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, id) });
}

export function listAssets(db: Executor): Promise<MediaAssetRow[]> {
  return db.query.mediaAssets.findMany({ orderBy: desc(mediaAssets.createdAt) });
}

export async function setAssetStatus(db: Executor, id: string, status: AssetStatus): Promise<void> {
  await db.update(mediaAssets).set({ status, updatedAt: new Date() }).where(eq(mediaAssets.id, id));
}

export interface DerivedPaths {
  proxyPath?: string;
  analysisPath?: string;
  thumbnailPath?: string;
}

export async function updateAssetDerived(
  db: Executor,
  id: string,
  paths: DerivedPaths,
): Promise<void> {
  await db
    .update(mediaAssets)
    .set({ ...paths, updatedAt: new Date() })
    .where(eq(mediaAssets.id, id));
}
