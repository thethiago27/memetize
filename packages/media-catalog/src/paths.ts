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

/** Resolves a repo-relative stored path back to an absolute path. */
export function resolveStorage(config: AppConfig, relative: string): string {
  return join(config.rootDir, relative);
}
