import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDir, fileExists } from './fs';

describe('fs helpers', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-fs-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('ensureDir creates nested directories', async () => {
    const nested = join(tmp, 'a', 'b', 'c');
    await ensureDir(nested);
    expect(await fileExists(nested)).toBe(true);
  });

  it('fileExists distinguishes present from absent paths', async () => {
    const file = join(tmp, 'present.txt');
    await writeFile(file, 'x');
    expect(await fileExists(file)).toBe(true);
    expect(await fileExists(join(tmp, 'missing.txt'))).toBe(false);
  });
});
