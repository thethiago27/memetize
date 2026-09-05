import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getSubtitles, replaceSubtitles } from './subtitles';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProject(id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'ANALYZING_AUDIO' });
}

describe.skipIf(!handle)('replaceSubtitles (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('replaces every previous row so a project has exactly one current track', async () => {
    const projectId = 'prj_subtitles_replace';
    await seedProject(projectId);

    await replaceSubtitles(db, {
      projectId,
      language: 'pt-BR',
      sourceLanguage: 'en',
      translated: true,
      lines: [{ startMs: 0, endMs: 1000, text: 'olá' }],
      model: 'gateway',
      modelVersion: '1.0.0/anthropic/claude-sonnet-4.5',
    });
    const second = await replaceSubtitles(db, {
      projectId,
      language: 'pt-BR',
      sourceLanguage: 'en',
      translated: true,
      lines: [
        { startMs: 0, endMs: 1000, text: 'olá' },
        { startMs: 1000, endMs: 2000, text: 'mundo' },
      ],
      model: 'fixture',
      modelVersion: '1.0.0',
    });
    expect(second.lines).toHaveLength(2);
    const latest = await getSubtitles(db, projectId);
    expect(latest?.id).toBe(second.id);
    expect(latest?.lines).toHaveLength(2);
  });

  it('persists an empty instrumental row', async () => {
    const projectId = 'prj_subtitles_empty';
    await seedProject(projectId);
    const row = await replaceSubtitles(db, {
      projectId,
      language: 'pt-BR',
      sourceLanguage: null,
      translated: false,
      lines: [],
      model: 'none',
      modelVersion: '1.0.0',
    });
    expect(row.lines).toEqual([]);
    expect(row.translated).toBe(false);
    expect(row.model).toBe('none');
  });
});
