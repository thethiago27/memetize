import type { NarrativeSegment } from '@memetize/contracts';
import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listNarrativeSegments, replaceNarrativeSegments } from './narrative';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('replaceNarrativeSegments sourceKind (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('persists lyric and instrumental source kinds', async () => {
    await db
      .insert(projects)
      .values({ id: 'prj_narrative_kind', filename: 'song.mp3', status: 'PLANNING' });
    const segments: NarrativeSegment[] = [
      {
        sourceKind: 'LYRIC',
        startMs: 0,
        endMs: 2_000,
        lyrics: 'hook',
        meaning: 'hook',
        emotion: 'joy',
        narrativeFunction: 'chorus',
        visualIdeas: ['hook'],
        literalness: 0.5,
        ironyPotential: 0.2,
        energy: 0.8,
      },
      {
        sourceKind: 'INSTRUMENTAL',
        startMs: 2_000,
        endMs: 4_000,
        lyrics: '',
        meaning: 'instrumental chorus',
        emotion: 'neutral',
        narrativeFunction: 'chorus',
        visualIdeas: ['chorus', 'instrumental'],
        literalness: 0.5,
        ironyPotential: 0.5,
        energy: 0.8,
      },
    ];

    await replaceNarrativeSegments(db, {
      projectId: 'prj_narrative_kind',
      segments,
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    });

    const rows = await listNarrativeSegments(db, 'prj_narrative_kind');
    expect(rows.map((row) => row.sourceKind)).toEqual(['LYRIC', 'INSTRUMENTAL']);
    expect(rows[0]?.startMs).toBe(0);
    expect(rows[1]?.endMs).toBe(4_000);
  });
});
