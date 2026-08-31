import { join } from 'node:path';
import type { AppConfig } from '@memetize/shared';

/**
 * Storage layout for the music/project pipeline (spec sections 24, 39).
 * Deliberately separate from `@memetize/media-catalog`'s `storage/assets`
 * layout: projects are a different domain (music, not video).
 */
export interface StoragePath {
  /** Absolute path for filesystem I/O. */
  absolute: string;
  /** Repo-relative path stored in the database (spec section 11). */
  relative: string;
}

/** `storage/audio/{projectId}` */
export function audioDir(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'audio', projectId),
    relative: `${config.storageDirRelative}/audio/${projectId}`,
  };
}

/** A named file inside a project's audio directory, e.g. `original.mp3`. */
export function audioFile(config: AppConfig, projectId: string, name: string): StoragePath {
  const dir = audioDir(config, projectId);
  return {
    absolute: join(dir.absolute, name),
    relative: `${dir.relative}/${name}`,
  };
}

/** Debug cache file for the Audio Analyzer output (spec section 64). */
export function audioDebugFile(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', projectId, 'audio.json'),
    relative: `${config.storageDirRelative}/cache/${projectId}/audio.json`,
  };
}

/** Debug cache file for the Lyrics worker output (spec section 64). */
export function lyricsDebugFile(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', projectId, 'lyrics.json'),
    relative: `${config.storageDirRelative}/cache/${projectId}/lyrics.json`,
  };
}

/** Debug cache file for the Narrative Analyzer output: prompt version, raw and parsed (spec section 64). */
export function narrativeDebugFile(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', projectId, 'narrative.json'),
    relative: `${config.storageDirRelative}/cache/${projectId}/narrative.json`,
  };
}

/** Debug cache file for the matching funnel: queries, retrieved/ranked/shortlist (spec section 64). */
export function matchDebugFile(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', projectId, 'match.json'),
    relative: `${config.storageDirRelative}/cache/${projectId}/match.json`,
  };
}

/** Debug cache file for the Director's raw picks + prompt version (spec section 64). */
export function directorDebugFile(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', projectId, 'director.json'),
    relative: `${config.storageDirRelative}/cache/${projectId}/director.json`,
  };
}

/** Debug cache file for the Timing Optimizer's per-clip adjustments (spec section 64). */
export function timingDebugFile(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', projectId, 'timing.json'),
    relative: `${config.storageDirRelative}/cache/${projectId}/timing.json`,
  };
}

/** The official `Timeline` document (spec sections 34, 54), kept alongside the debug files. */
export function timelineFile(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', projectId, 'timeline.json'),
    relative: `${config.storageDirRelative}/cache/${projectId}/timeline.json`,
  };
}

/** `storage/renders/{projectId}` (spec section 11). */
export function renderDir(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'renders', projectId),
    relative: `${config.storageDirRelative}/renders/${projectId}`,
  };
}

/** A render's MP4, e.g. `render_001.mp4` (spec section 39: `renders` is append-only). */
export function renderFile(config: AppConfig, projectId: string, version: number): StoragePath {
  const dir = renderDir(config, projectId);
  const name = `render_${String(version).padStart(3, '0')}.mp4`;
  return {
    absolute: join(dir.absolute, name),
    relative: `${dir.relative}/${name}`,
  };
}

/** Debug cache file for the Renderer's FFmpeg args + graph + validation (spec section 64). */
export function renderDebugFile(config: AppConfig, projectId: string): StoragePath {
  return {
    absolute: join(config.storageDir, 'cache', projectId, 'render.json'),
    relative: `${config.storageDirRelative}/cache/${projectId}/render.json`,
  };
}

/** Resolves a repo-relative stored path back to an absolute path. */
export function resolveStorage(config: AppConfig, relative: string): string {
  return join(config.rootDir, relative);
}
