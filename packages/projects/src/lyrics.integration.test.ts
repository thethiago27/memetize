import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getLyrics, replaceLyrics } from './lyrics';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProject(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'ANALYZING_AUDIO' });
}

describe.skipIf(!handle)('replaceLyrics (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('replaces lyrics for the same project/source/model/version instead of duplicating them', async () => {
    const projectId = 'prj_lyrics_test';
    await seedProject(db, projectId);

    const first = await replaceLyrics(db, {
      projectId,
      source: 'USER',
      lines: [{ startMs: 0, endMs: 1000, text: 'first', words: [] }],
      model: 'lrc-parser',
      modelVersion: '1.0.0',
    });
    expect(first.lines).toHaveLength(1);

    const second = await replaceLyrics(db, {
      projectId,
      source: 'USER',
      lines: [
        { startMs: 0, endMs: 1000, text: 'first', words: [] },
        { startMs: 1000, endMs: 2000, text: 'second', words: [] },
      ],
      model: 'lrc-parser',
      modelVersion: '1.0.0',
    });
    expect(second.lines).toHaveLength(2);

    const latest = await getLyrics(db, projectId);
    expect(latest?.lines).toHaveLength(2);
  });

  it('persists an empty (instrumental) fixture as a successful result', async () => {
    const projectId = 'prj_lyrics_empty';
    await seedProject(db, projectId);

    const row = await replaceLyrics(db, {
      projectId,
      source: 'FIXTURE',
      lines: [],
      model: 'fixture',
      modelVersion: '1.0.0',
    });
    expect(row.lines).toEqual([]);
    expect(row.source).toBe('FIXTURE');
  });
});
