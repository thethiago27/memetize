import { copyFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { type Database, type MediaAssetRow, mediaAssets } from '@memetize/database';
import {
  enqueueJob,
  ensureEntityExecution,
  startGeneration,
  stepKeyFor,
} from '@memetize/job-system';
import { type AppConfig, ensureDir, assetId as newAssetId, sha256File } from '@memetize/shared';
import { eq } from 'drizzle-orm';
import { assetDir, assetFile } from './paths';
import { probeVideo } from './probe';

const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);

const EXT_CONTENT_TYPE: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

export interface IngestArgs {
  db: Database;
  config: AppConfig;
  filePath: string;
  source?: string;
  /** Display name to persist (e.g. the original upload filename); falls back to
   * the temp file's basename when absent (minor issue). */
  displayName?: string;
}

export interface IngestResult {
  asset: MediaAssetRow;
  /** false when the file was already catalogued (same checksum). */
  created: boolean;
}

/**
 * Asset Ingestor (spec section 13): validate, checksum, dedup, copy original,
 * ffprobe, register, then enqueue normalization. Deduplication is by SHA-256, so
 * re-adding the same bytes never creates a second asset.
 */
export async function ingestAsset({
  db,
  config,
  filePath,
  source,
  displayName,
}: IngestArgs): Promise<IngestResult> {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported file extension: ${ext || '(none)'}`);
  }

  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`file not found: ${filePath}`);
  }

  const checksum = await sha256File(filePath);
  const existing = await db.query.mediaAssets.findFirst({
    where: eq(mediaAssets.checksum, checksum),
  });
  if (existing) {
    return { asset: existing, created: false };
  }

  const id = newAssetId();
  const dir = assetDir(config, id);
  await ensureDir(dir.absolute);

  const original = assetFile(config, id, `original${ext}`);
  await copyFile(filePath, original.absolute);

  const probe = await probeVideo(original.absolute);

  // The asset row, its coordination row, its first generation and its first job
  // commit together in one transaction (F09/F10) — the same contract as project
  // ingest: a crash cannot leave an asset with no generation and no job.
  let asset: MediaAssetRow;
  try {
    asset = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(mediaAssets)
        .values({
          id,
          filename: displayName ?? basename(filePath),
          originalPath: original.relative,
          checksum,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          fpsMilli: probe.fpsMilli,
          contentType: EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream',
          sizeBytes: stats.size,
          status: 'INGESTED',
          source: source ?? null,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('failed to insert media asset');

      await ensureEntityExecution(tx, 'asset', id);
      const generationId = await startGeneration(tx, 'asset', id);
      await enqueueJob(tx, {
        type: 'VIDEO_NORMALIZE',
        entityId: id,
        input: { assetId: id, originalPath: original.relative },
        generationId,
        stepKey: stepKeyFor('VIDEO_NORMALIZE'),
      });
      return row;
    });
  } catch (error) {
    // Lost a race on the unique checksum: return the winner instead of failing.
    const raced = await db.query.mediaAssets.findFirst({
      where: eq(mediaAssets.checksum, checksum),
    });
    if (raced) return { asset: raced, created: false };
    throw error;
  }

  return { asset, created: true };
}
