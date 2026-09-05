import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

export interface RenderTarget {
  directory: string;
  encodingPath: string;
}

/**
 * Reserves an exclusive scratch directory for one render attempt (F09). Two
 * concurrent renders of the same project each get a private `encoding.mp4`, so
 * FFmpeg's `-y` can never have two processes clobber the same file. The finished
 * encode is validated here and only then moved to its published, version-named
 * path under the entity lock; a crash before the move leaves an orphan the
 * reconciler removes.
 */
export async function allocateRenderTarget(rendersDirectory: string): Promise<RenderTarget> {
  const directory = await mkdtemp(join(rendersDirectory, 'attempt-'));
  return { directory, encodingPath: join(directory, 'encoding.mp4') };
}
