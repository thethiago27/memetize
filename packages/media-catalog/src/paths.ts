import type { AppConfig } from '@memetize/shared';
import { type StoragePath, storagePath } from '@memetize/shared';

export { resolveStorage } from '@memetize/shared';
/**
 * Storage layout for the video catalog (spec sections 11, 18). Every location
 * is one `storagePath` call, so what a stored key looks like is decided in
 * exactly one place (`@memetize/shared`), not re-spelled per file.
 */
export type { StoragePath };

/** `storage/assets/{assetId}` */
export function assetDir(config: AppConfig, assetId: string): StoragePath {
  return storagePath(config, 'assets', assetId);
}

/** A named file inside an asset's directory, e.g. `proxy.mp4`. */
export function assetFile(config: AppConfig, assetId: string, name: string): StoragePath {
  return storagePath(config, 'assets', assetId, name);
}

/** `storage/frames/{assetId}/{sceneId}` */
export function frameDir(config: AppConfig, assetId: string, sceneId: string): StoragePath {
  return storagePath(config, 'frames', assetId, sceneId);
}

/** A sampled frame file, e.g. `frame_001500.jpg` (spec section 18). */
export function frameFile(
  config: AppConfig,
  assetId: string,
  sceneId: string,
  timestampMs: number,
): StoragePath {
  return storagePath(
    config,
    'frames',
    assetId,
    sceneId,
    `frame_${String(timestampMs).padStart(6, '0')}.jpg`,
  );
}

/** Debug cache file for a scene's vision analysis (spec section 64). */
export function visionDebugFile(config: AppConfig, assetId: string, sceneId: string): StoragePath {
  return storagePath(config, 'cache', assetId, 'vision', `${sceneId}.json`);
}

/** Debug cache file for a moment's embedding source texts (spec section 64). */
export function embeddingDebugFile(
  config: AppConfig,
  assetId: string,
  momentId: string,
): StoragePath {
  return storagePath(config, 'cache', assetId, 'embeddings', `${momentId}.json`);
}

/** `storage/temp/{momentId}.mp4` (spec section 75): CLI-only export, no job. */
export function momentExportFile(config: AppConfig, momentId: string): StoragePath {
  return storagePath(config, 'temp', `${momentId}.mp4`);
}
