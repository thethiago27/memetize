import {
  createTestDatabase,
  type Database,
  narrativeSegments,
  projects,
  truncateAll,
} from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listSegmentMatches, replaceSegmentMatches } from './match';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProjectWithSegment(db: Database, projectId: string): Promise<string> {
  await db.insert(projects).values({ id: projectId, filename: 'song.mp3', status: 'PLANNING' });
  const [row] = await db
    .insert(narrativeSegments)
    .values({
      id: `nar_${projectId}`,
      projectId,
      startMs: 0,
      endMs: 2000,
      lyrics: 'hello world',
      meaning: 'greeting',
      emotion: 'joy',
      narrativeFunction: 'setup',
      visualIdeas: ['hello'],
      literalness: 0.5,
      ironyPotential: 0.2,
      energy: 0.5,
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    })
    .returning();
  if (!row) throw new Error('failed to seed narrative segment');
  return row.id;
}

describe.skipIf(!handle)('replaceSegmentMatches (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('replaces the funnel for the same project/ranker/version instead of duplicating it', async () => {
    const projectId = 'prj_match_test';
    const segmentId = await seedProjectWithSegment(db, projectId);

    const first = await replaceSegmentMatches(db, {
      projectId,
      ranker: 'fixture',
      rankerVersion: '1.0.0',
      matches: [
        {
          segmentId,
          retrieved: [
            {
              momentId: 'mom_1',
              assetId: 'ast_1',
              semanticScore: 0.9,
              source: 'CATALOG',
              negativeScore: 0,
            },
          ],
          ranked: [
            {
              momentId: 'mom_1',
              assetId: 'ast_1',
              semanticScore: 0.9,
              emotionScore: 0.5,
              narrativeScore: 0.5,
              durationScore: 0.5,
              energyScore: 0.5,
              qualityScore: 0.5,
              noveltyScore: 1,
              usageScore: 1,
              finalScore: 0.72,
            },
          ],
          shortlist: [{ momentId: 'mom_1', assetId: 'ast_1', finalScore: 0.72, penalties: [] }],
        },
      ],
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.shortlist).toHaveLength(1);

    const second = await replaceSegmentMatches(db, {
      projectId,
      ranker: 'fixture',
      rankerVersion: '1.0.0',
      matches: [
        {
          segmentId,
          retrieved: [
            {
              momentId: 'mom_2',
              assetId: 'ast_2',
              semanticScore: 0.8,
              source: 'CATALOG',
              negativeScore: 0,
            },
          ],
          ranked: [],
          shortlist: [],
        },
      ],
    });
    expect(second).toHaveLength(1);

    const latest = await listSegmentMatches(db, projectId);
    expect(latest).toHaveLength(1);
    expect(latest[0]?.retrieved[0]?.momentId).toBe('mom_2');
  });

  it('persists an empty shortlist when the catalog has no candidates', async () => {
    const projectId = 'prj_match_empty';
    const segmentId = await seedProjectWithSegment(db, projectId);

    const rows = await replaceSegmentMatches(db, {
      projectId,
      ranker: 'fixture',
      rankerVersion: '1.0.0',
      matches: [{ segmentId, retrieved: [], ranked: [], shortlist: [] }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shortlist).toEqual([]);
  });
});
