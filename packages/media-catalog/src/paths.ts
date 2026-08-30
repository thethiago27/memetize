import { join } from 'node:path';
import type { AppConfig } from '@memetize/shared';

export interface StoragePath {
  /** Absolute path for filesystem I/O. */
  absolute: string;
  /** Repo-relative path stored in the database (spec section 11). */
  relative: string;
}

/** `storage/assets/{assetId}` */
export function assetDir(config: AppConfig, assetId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'assets', assetId),
    relative: `${config.storageDirRelative}/assets/${assetId}`,
  };
}

/** A named file inside an asset's directory, e.g. `proxy.mp4`. */
export function assetFile(config: AppConfig, assetId: string, name: string): StoragePath {
  const dir = assetDir(config, assetId);
  return {
    absolute: join(dir.absolute, name),
    relative: `${dir.relative}/${name}`,
  };
}

/** `storage/frames/{assetId}/{sceneId}` */
export function frameDir(config: AppConfig, assetId: string, sceneId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'frames', assetId, sceneId),
    relative: `${config.storageDirRelative}/frames/${assetId}/${sceneId}`,
  };
}

/** A sampled frame file, e.g. `frame_001500.jpg` (spec section 18). */
export function frameFile(
  config: AppConfig,
  assetId: string,
  sceneId: string,
  timestampMs: number,
): StoragePath {
  const dir = frameDir(config, assetId, sceneId);
  const name = `frame_${String(timestampMs).padStart(6, '0')}.jpg`;
  return {
    absolute: join(dir.absolute, name),
    relative: `${dir.relative}/${name}`,
  };
}

/** Debug cache file for a scene's vision analysis (spec section 64). */
export function visionDebugFile(config: AppConfig, assetId: string, sceneId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', assetId, 'vision', `${sceneId}.json`),
    relative: `${config.storageDirRelative}/cache/${assetId}/vision/${sceneId}.json`,
  };
}

/** Debug cache file for a moment's embedding source texts (spec section 64). */
export function embeddingDebugFile(
  config: AppConfig,
  assetId: string,
  momentId: string,
): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', assetId, 'embeddings', `${momentId}.json`),
    relative: `${config.storageDirRelative}/cache/${assetId}/embeddings/${momentId}.json`,
  };
}

/** `storage/temp/{momentId}.mp4` (spec section 75): CLI-only export, no job. */
export function momentExportFile(config: AppConfig, momentId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'temp', `${momentId}.mp4`),
    relative: `${config.storageDirRelative}/temp/${momentId}.mp4`,
  };
}

/** Resolves a repo-relative stored path back to an absolute path. */
export function resolveStorage(config: AppConfig, relative: string): string {
  return join(config.rootDir, relative);
}
