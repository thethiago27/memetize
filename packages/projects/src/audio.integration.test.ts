import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getAudioAnalysis, replaceAudioAnalysis } from './audio';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProject(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'ANALYZING_AUDIO' });
}

describe.skipIf(!handle)('replaceAudioAnalysis (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('replaces the analysis for the same project/analyzer/version instead of duplicating it', async () => {
    const projectId = 'prj_audio_test';
    await seedProject(db, projectId);

    const first = await replaceAudioAnalysis(db, {
      projectId,
      durationMs: 4000,
      bpm: 120,
      beats: [{ timeMs: 0, strength: 0.9 }],
      downbeats: [0],
      sections: [{ type: 'intro', startMs: 0, endMs: 4000 }],
      energyCurve: [{ timeMs: 0, value: 0.5 }],
      analyzer: 'fixture',
      analyzerVersion: '1.0.0',
    });
    expect(first.beats).toHaveLength(1);

    const second = await replaceAudioAnalysis(db, {
      projectId,
      durationMs: 4000,
      bpm: 120,
      beats: [
        { timeMs: 0, strength: 0.9 },
        { timeMs: 500, strength: 0.6 },
      ],
      downbeats: [0],
      sections: [{ type: 'intro', startMs: 0, endMs: 4000 }],
      energyCurve: [{ timeMs: 0, value: 0.5 }],
      analyzer: 'fixture',
      analyzerVersion: '1.0.0',
    });
    expect(second.beats).toHaveLength(2);

    const latest = await getAudioAnalysis(db, projectId);
    expect(latest?.beats).toHaveLength(2);
  });

  it('rejects a float millisecond value', async () => {
    const projectId = 'prj_audio_float';
    await seedProject(db, projectId);

    await expect(
      replaceAudioAnalysis(db, {
        projectId,
        durationMs: 4000.5,
        bpm: 120,
        beats: [],
        downbeats: [],
        sections: [],
        energyCurve: [],
        analyzer: 'fixture',
        analyzerVersion: '1.0.0',
      }),
    ).rejects.toThrow();
  });
});
