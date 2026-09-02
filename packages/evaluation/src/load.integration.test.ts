import {
  createTestDatabase,
  type Database,
  mediaAssets,
  moments,
  scenes,
  truncateAll,
} from '@memetize/database';
import { recordFeedbackEvents } from '@memetize/feedback';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { evaluateRanker } from './evaluate';
import { loadRankerCases } from './load';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('loadRankerCases', () => {
  beforeEach(() => truncateAll(db));
  afterAll(async () => {
    await handle?.close();
  });

  it('loads swap cases with their moment rows', async () => {
    await db.insert(mediaAssets).values({
      id: 'ast_1',
      filename: 'clip.mp4',
      originalPath: 'storage/assets/ast_1/original.mp4',
      checksum: 'sum_1',
      durationMs: 4000,
      status: 'READY',
    });
    await db.insert(scenes).values({
      id: 'scn_1',
      assetId: 'ast_1',
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      detector: 'fixture',
      detectorVersion: '1.0.0',
    });
    await db.insert(moments).values(
      ['mom_a', 'mom_b'].map((id, index) => ({
        id,
        sceneId: 'scn_1',
        assetId: 'ast_1',
        startMs: index * 2000,
        endMs: index * 2000 + 2000,
        durationMs: 2000,
        description: id,
        extractor: 'fixture',
        extractorVersion: '1.0.0',
      })),
    );
    const retrieved = [
      {
        momentId: 'mom_a',
        assetId: 'ast_1',
        semanticScore: 0.9,
        source: 'CATALOG' as const,
        negativeScore: 0,
      },
      {
        momentId: 'mom_b',
        assetId: 'ast_1',
        semanticScore: 0.8,
        source: 'CATALOG' as const,
        negativeScore: 0,
      },
    ];
    await recordFeedbackEvents(db, [
      {
        kind: 'SWAP_OUT',
        source: 'USER',
        projectId: 'prj_1',
        segmentId: 'seg_1',
        momentId: 'mom_a',
        assetId: 'ast_1',
        context: {
          startMs: 0,
          endMs: 2000,
          narrativeFunction: 'payoff',
          emotion: 'joy',
          energy: 0.5,
          retrieved,
        },
      },
      {
        kind: 'SWAP_IN',
        source: 'USER',
        projectId: 'prj_1',
        segmentId: 'seg_1',
        momentId: 'mom_b',
        assetId: 'ast_1',
        context: {
          startMs: 0,
          endMs: 2000,
          narrativeFunction: 'payoff',
          emotion: 'joy',
          energy: 0.5,
          retrieved,
        },
      },
    ]);

    const dataset = await loadRankerCases(db);
    expect(dataset.cases).toHaveLength(2);
    expect([...dataset.moments.keys()].sort()).toEqual(['mom_a', 'mom_b']);
    const result = evaluateRanker(dataset);
    expect(result.caseCount).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.chosen.count).toBe(1);
    expect(result.rejected.count).toBe(1);
  });
});
