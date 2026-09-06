import { isAbsolute, join, resolve, sep } from 'node:path';
import type { AppConfig } from './config';

/** A location under the storage root, in both forms the system needs. */
export interface StoragePath {
  /** Absolute path for filesystem I/O. */
  absolute: string;
  /** The key persisted in the database (spec section 11). */
  relative: string;
}

export class StoragePathError extends Error {
  readonly code = 'STORAGE_PATH_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'StoragePathError';
  }
}

/**
 * Builds a path under the storage root from its segments — the one place that
 * decides what a stored key looks like.
 *
 * With a repo-relative `STORAGE_PATH` (the default) the key keeps its
 * configured prefix, e.g. `storage/audio/prj_1/original.mp3`, so rows written
 * by earlier versions keep resolving. With an absolute `STORAGE_PATH` there is
 * no meaningful repo-relative prefix, so the key is stored relative to the
 * storage root itself (`audio/prj_1/original.mp3`). `resolveStorage` reads both.
 */
export function storagePath(config: AppConfig, ...segments: string[]): StoragePath {
  const key = segments.join('/');
  const prefix = config.storageDirRelative;
  return {
    absolute: join(config.storageDir, ...segments),
    relative: prefix ? `${prefix}/${key}` : key,
  };
}

/**
 * Resolves a stored key back to an absolute path, confined to the storage root.
 *
 * Accepts both key shapes (`storage/…` and storage-relative) and refuses
 * anything that would escape — an absolute key, or one that climbs out with
 * `..`. Confinement lives here rather than only at the HTTP edge so every
 * caller gets it, not just the media route.
 */
export function resolveStorage(config: AppConfig, key: string): string {
  if (isAbsolute(key)) {
    throw new StoragePathError(`stored path must be relative, got absolute "${key}"`);
  }
  const prefix = config.storageDirRelative;
  const bare =
    prefix && (key === prefix || key.startsWith(`${prefix}/`))
      ? key.slice(prefix.length).replace(/^\/+/, '')
      : key;

  const root = resolve(config.storageDir);
  const absolute = resolve(root, bare);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new StoragePathError(`stored path escapes the storage root: "${key}"`);
  }
  return absolute;
}
