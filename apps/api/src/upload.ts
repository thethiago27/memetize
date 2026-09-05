import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile } from '@fastify/multipart';

export interface SavedUpload {
  /** Internal temp path the upload was written to. */
  path: string;
  /** The user's original filename, sanitized for display only. */
  originalName: string;
}

/**
 * Sanitizes an uploaded filename for display (minor issue). Strips any path,
 * control characters, and the `.`/`..` degenerate names. For display only, never
 * for use as a storage key.
 */
export function uploadedDisplayName(originalFilename: string): string {
  const leaf = originalFilename.split(/[\\/]/).at(-1) ?? '';
  // Drop C0 control chars and DEL without a control-char regex literal.
  const clean = [...leaf]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim();
  return clean && clean !== '.' && clean !== '..' ? clean : 'upload';
}

export async function saveUpload(file: MultipartFile): Promise<SavedUpload> {
  const ext = extname(file.filename) || '';
  const dest = join(tmpdir(), `memetize-upload-${randomBytes(8).toString('hex')}${ext}`);
  await pipeline(file.file, createWriteStream(dest));
  return { path: dest, originalName: uploadedDisplayName(file.filename) };
}

export async function removeUpload(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}
