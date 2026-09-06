import type { AppConfig } from '@memetize/shared';
import { type StoragePath, storagePath } from '@memetize/shared';

export { resolveStorage } from '@memetize/shared';
/**
 * Storage layout for the music/project pipeline (spec sections 24, 39).
 * Deliberately separate from `@memetize/media-catalog`'s `storage/assets`
 * layout: projects are a different domain (music, not video).
 *
 * Every location is one `storagePath` call, so what a stored key looks like is
 * decided in exactly one place (`@memetize/shared`), not re-spelled per file.
 */
export type { StoragePath };

/** `storage/audio/{projectId}` */
export function audioDir(config: AppConfig, projectId: string): StoragePath {
  return storagePath(config, 'audio', projectId);
}

/** A named file inside a project's audio directory, e.g. `original.mp3`. */
export function audioFile(config: AppConfig, projectId: string, name: string): StoragePath {
  return storagePath(config, 'audio', projectId, name);
}

/** A project's debug cache file, e.g. `audio.json` (spec section 64). */
function projectCacheFile(config: AppConfig, projectId: string, name: string): StoragePath {
  return storagePath(config, 'cache', projectId, name);
}

/** Debug cache file for the Audio Analyzer output (spec section 64). */
export function audioDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'audio.json');
}

/** Debug cache file for the Subtitles worker output (translated-subtitles spec). */
export function subtitlesDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'subtitles.json');
}

/** Debug cache file for the Lyrics worker output (spec section 64). */
export function lyricsDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'lyrics.json');
}

/** Debug cache file for the Narrative Analyzer output: prompt version, raw and parsed (spec section 64). */
export function narrativeDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'narrative.json');
}

/** Debug cache file for the matching funnel: queries, retrieved/ranked/shortlist (spec section 64). */
export function matchDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'match.json');
}

/** Evaluation report (editorial-memory spec): `pnpm cli eval ranker` output. */
export function evalReportFile(config: AppConfig, name: string): StoragePath {
  return storagePath(config, 'cache', 'eval', `${name}.json`);
}

/** Debug cache file for the Director's raw picks + prompt version (spec section 64). */
export function directorDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'director.json');
}

/** Debug cache file for the Timing Optimizer's per-clip adjustments (spec section 64). */
export function timingDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'timing.json');
}

/** Debug cache file for the Effects Planner's planned zooms (spec section 64). */
export function effectsDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'effects.json');
}

/** Debug cache file for the Renderer's FFmpeg args + graph + validation (spec section 64). */
export function renderDebugFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'render.json');
}

/**
 * The project's timeline documents (spec sections 34, 54), one file per
 * version: `storage/timelines/{projectId}/v{n}.json`.
 */
export function timelineDir(config: AppConfig, projectId: string): StoragePath {
  return storagePath(config, 'timelines', projectId);
}

/** `storage/timelines/{projectId}/v{n}.json` (spec sections 34, 54). */
export function timelineVersionFile(
  config: AppConfig,
  projectId: string,
  version: number,
): StoragePath {
  return storagePath(config, 'timelines', projectId, `v${version}.json`);
}

/**
 * The latest `Timeline` document, kept alongside the debug files as a stable
 * path for tooling that does not track versions.
 */
export function timelineFile(config: AppConfig, projectId: string): StoragePath {
  return projectCacheFile(config, projectId, 'timeline.json');
}

/** `storage/renders/{projectId}` (spec section 11). */
export function renderDir(config: AppConfig, projectId: string): StoragePath {
  return storagePath(config, 'renders', projectId);
}

/** A render's MP4, e.g. `render_001.mp4` (spec section 39: `renders` is append-only). */
export function renderFile(config: AppConfig, projectId: string, version: number): StoragePath {
  return storagePath(
    config,
    'renders',
    projectId,
    `render_${String(version).padStart(3, '0')}.mp4`,
  );
}
