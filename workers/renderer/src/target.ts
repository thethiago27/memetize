import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface RenderTarget {
  directory: string;
  /** Where FFmpeg writes; never published directly. */
  encodingPath: string;
  /** The probed, validated encode waiting to be moved into place under the lock. */
  readyPath: string;
}

const ATTEMPT_PREFIX = 'attempt-';

/** Attempt directories older than this are orphans of a crashed/superseded render. */
export const ORPHAN_ATTEMPT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Reserves an exclusive scratch directory for one render attempt (F09). Two
 * concurrent renders of the same project each get a private `encoding.mp4`, so
 * FFmpeg's `-y` can never have two processes clobber the same file. The flow is
 * encode -> probe/validate -> rename to `ready.mp4` -> publish: the row insert
 * and the move to the version-named path happen in one transaction under the
 * entity lock (see `insertRender`'s `publishFile`), so the database never
 * announces a render whose file is missing. A crash before publication leaves an
 * orphan attempt directory that `cleanupOrphanRenderAttempts` removes.
 */
export async function allocateRenderTarget(rendersDirectory: string): Promise<RenderTarget> {
  const directory = await mkdtemp(join(rendersDirectory, ATTEMPT_PREFIX));
  return {
    directory,
    encodingPath: join(directory, 'encoding.mp4'),
    readyPath: join(directory, 'ready.mp4'),
  };
}

/**
 * Artifact reconciler (F09): removes attempt directories older than
 * `maxAgeMs` — leftovers of attempts that crashed between encoding and
 * publication, or whose publication was refused (lease lost, generation
 * superseded). Published renders live at their version-named path and are never
 * touched. Runs before each render; returns how many were removed.
 */
export async function cleanupOrphanRenderAttempts(
  rendersDirectory: string,
  maxAgeMs: number = ORPHAN_ATTEMPT_MAX_AGE_MS,
  now: number = Date.now(),
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(rendersDirectory);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.startsWith(ATTEMPT_PREFIX)) continue;
    const path = join(rendersDirectory, entry);
    try {
      const info = await stat(path);
      if (!info.isDirectory() || now - info.mtimeMs < maxAgeMs) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Another attempt may have removed it concurrently; nothing to do.
    }
  }
  return removed;
}
