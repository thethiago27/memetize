import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile } from '@fastify/multipart';

export async function saveUpload(file: MultipartFile): Promise<string> {
  const ext = extname(file.filename) || '';
  const dest = join(tmpdir(), `memetize-upload-${randomBytes(8).toString('hex')}${ext}`);
  await pipeline(file.file, createWriteStream(dest));
  return dest;
}

export async function removeUpload(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}
