import type { MomentCandidate } from '@memetize/contracts';
import {
  createTestDatabase,
  type Database,
  mediaAssets,
  scenes,
  truncateAll,
} from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { replaceMoments } from './moments';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedAssetAndScene(db: Database, assetId: string, sceneId: string): Promise<void> {
  await db.insert(mediaAssets).values({
    id: assetId,
    filename: 'clip.mp4',
    originalPath: `storage/assets/${assetId}/original.mp4`,
    checksum: `checksum-${assetId}`,
    status: 'READY',
  });
  await db.insert(scenes).values({
    id: sceneId,
    assetId,
    startMs: 0,
    endMs: 5000,
    durationMs: 5000,
    detector: 'fixture',
    detectorVersion: '1.0.0',
  });
}

function candidate(sceneId: string, startMs: number, endMs: number): MomentCandidate {
  return {
    sceneId,
    startMs,
    endMs,
    description: 'a moment',
    primaryEmotion: 'joy',
    emotionIntensity: 0.5,
    visualEnergy: 0.5,
    qualityScore: 0.5,
    metadata: {},
  } as MomentCandidate;
}

describe.skipIf(!handle)('replaceMoments id preservation (F12)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('reuses the id when the exact interval reappears, and mints a new one when it changes', async () => {
    const assetId = 'ast_f12';
    const sceneId = 'scn_f12';
    await seedAssetAndScene(db, assetId, sceneId);

    const first = await replaceMoments(db, {
      assetId,
      extractor: 'fixture',
      extractorVersion: '1.0.0',
      moments: [candidate(sceneId, 1000, 2000), candidate(sceneId, 3000, 4000)],
    });
    const idByInterval = new Map(first.map((m) => [`${m.startMs}:${m.endMs}`, m.id]));

    // Re-extract: one interval unchanged (1000-2000), one shifted (3000-4100).
    const second = await replaceMoments(db, {
      assetId,
      extractor: 'fixture',
      extractorVersion: '1.0.0',
      moments: [candidate(sceneId, 1000, 2000), candidate(sceneId, 3000, 4100)],
    });
    const unchanged = second.find((m) => m.startMs === 1000 && m.endMs === 2000);
    const shifted = second.find((m) => m.startMs === 3000 && m.endMs === 4100);

    // Unchanged interval keeps its id; a moment keyed to it stays valid.
    expect(unchanged?.id).toBe(idByInterval.get('1000:2000'));
    // Shifted interval gets a fresh id (its old memory is left as history).
    expect(shifted?.id).not.toBe(idByInterval.get('3000:4000'));
  });

  it('keeps the id when the same interval comes back from another extractor/version, and drops stale rows', async () => {
    const assetId = 'ast_f12_provider';
    const sceneId = 'scn_f12_provider';
    await seedAssetAndScene(db, assetId, sceneId);

    const fixture = await replaceMoments(db, {
      assetId,
      extractor: 'fixture',
      extractorVersion: '1.0.0',
      moments: [candidate(sceneId, 1000, 2000), candidate(sceneId, 3000, 4000)],
    });
    const stableId = fixture.find((m) => m.startMs === 1000)?.id;

    // Switching to the gateway model reproduces one interval and changes the other.
    const gateway = await replaceMoments(db, {
      assetId,
      extractor: 'gateway',
      extractorVersion: '1.0.0/openai/gpt-5',
      moments: [candidate(sceneId, 1000, 2000), candidate(sceneId, 3000, 4500)],
    });
    expect(gateway.find((m) => m.startMs === 1000)?.id).toBe(stableId);
    // The previous extractor's rows do not linger next to the new catalog.
    const all = await db.query.moments.findMany({ where: (t, { eq }) => eq(t.assetId, assetId) });
    expect(all).toHaveLength(2);
    expect(all.every((m) => m.extractor === 'gateway')).toBe(true);
  });

  it('gives an interval its original id back after it disappears and is re-extracted (F12)', async () => {
    const assetId = 'ast_f12_return';
    const sceneId = 'scn_f12_return';
    await seedAssetAndScene(db, assetId, sceneId);

    const first = await replaceMoments(db, {
      assetId,
      extractor: 'fixture',
      extractorVersion: '1.0.0',
      moments: [candidate(sceneId, 1000, 2000)],
    });
    const originalId = first[0]?.id;

    // A pass that no longer finds the interval...
    await replaceMoments(db, {
      assetId,
      extractor: 'fixture',
      extractorVersion: '1.1.0',
      moments: [candidate(sceneId, 500, 1500)],
    });
    // ...and a later one that finds it again: bans/feedback keyed by the id apply again.
    const third = await replaceMoments(db, {
      assetId,
      extractor: 'fixture',
      extractorVersion: '1.2.0',
      moments: [candidate(sceneId, 1000, 2000)],
    });
    expect(third[0]?.id).toBe(originalId);
  });
});
