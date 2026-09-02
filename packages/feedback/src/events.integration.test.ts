import {
  createTestDatabase,
  type Database,
  mediaAssets,
  moments,
  scenes,
  truncateAll,
} from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  banAsset,
  banMoment,
  excludeRange,
  includeRange,
  listActiveBans,
  unbanMoment,
} from './bans';
import { getFeedbackEvent, listFeedbackEvents, recordFeedbackEvents } from './events';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('feedback events repository', () => {
  beforeEach(() => truncateAll(db));
  afterAll(async () => {
    await handle?.close();
  });

  it('records events append-only and lists them chronologically', async () => {
    const rows = await recordFeedbackEvents(db, [
      { kind: 'NOTE', note: 'global taste', source: 'USER' },
      { kind: 'NOTE', note: 'project taste', projectId: 'prj_1', source: 'USER' },
      {
        kind: 'SWAP_IN',
        projectId: 'prj_1',
        timelineVersion: 2,
        clipId: 'clp_1',
        segmentId: 'seg_1',
        momentId: 'mom_1',
        assetId: 'ast_1',
        context: { narrativeFunction: 'payoff', emotion: 'joy' },
        source: 'USER',
      },
      { kind: 'NOTE', note: 'other project', projectId: 'prj_2', source: 'USER' },
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.id).toMatch(/^fb_/);
    expect(rows[2]?.context).toEqual({ narrativeFunction: 'payoff', emotion: 'joy' });

    const all = await listFeedbackEvents(db);
    expect(all.map((row) => row.note ?? row.kind)).toEqual([
      'global taste',
      'project taste',
      'SWAP_IN',
      'other project',
    ]);

    const scoped = await listFeedbackEvents(db, { projectId: 'prj_1', order: 'desc' });
    expect(scoped.map((row) => row.note ?? row.kind)).toEqual([
      'SWAP_IN',
      'project taste',
      'global taste',
    ]);

    const ownOnly = await listFeedbackEvents(db, {
      projectId: 'prj_1',
      includeGlobalNotes: false,
    });
    expect(ownOnly).toHaveLength(2);

    const byKind = await listFeedbackEvents(db, { kinds: ['SWAP_IN'], momentId: 'mom_1' });
    expect(byKind).toHaveLength(1);
    expect(await getFeedbackEvent(db, byKind[0]?.id ?? '')).toMatchObject({ kind: 'SWAP_IN' });
  });

  it('resolves active bans from the latest ban/unban per id', async () => {
    await banMoment(db, { momentId: 'mom_a', assetId: 'ast_1', note: 'blurry' });
    await banMoment(db, { momentId: 'mom_b', assetId: 'ast_1' });
    await unbanMoment(db, { momentId: 'mom_a', assetId: 'ast_1' });
    await banAsset(db, { assetId: 'ast_9' });

    const bans = await listActiveBans(db);
    expect([...bans.momentIds]).toEqual(['mom_b']);
    expect([...bans.assetIds]).toEqual(['ast_9']);
  });

  it('resolves excluded ranges to every moment touching them, surviving reprocess', async () => {
    await db.insert(mediaAssets).values({
      id: 'ast_r',
      filename: 'clip.mp4',
      originalPath: 'storage/assets/ast_r/original.mp4',
      checksum: 'sum_r',
      durationMs: 10_000,
      status: 'READY',
    });
    await db.insert(scenes).values({
      id: 'scn_r',
      assetId: 'ast_r',
      startMs: 0,
      endMs: 10_000,
      durationMs: 10_000,
      detector: 'fixture',
      detectorVersion: '1.0.0',
    });
    const seed = (id: string, startMs: number, endMs: number) => ({
      id,
      sceneId: 'scn_r',
      assetId: 'ast_r',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      description: id,
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    });
    await db
      .insert(moments)
      .values([
        seed('mom_before', 0, 2000),
        seed('mom_touch', 1500, 3500),
        seed('mom_after', 6000, 8000),
      ]);

    await excludeRange(db, { assetId: 'ast_r', startMs: 2000, endMs: 5000 });
    let bans = await listActiveBans(db);
    expect([...bans.momentIds].sort()).toEqual(['mom_touch']);
    expect(bans.excludedRanges.get('ast_r')).toEqual([{ startMs: 2000, endMs: 5000 }]);

    // A "reprocessed" moment with a new id inside the range is excluded too.
    await db.insert(moments).values([seed('mom_new', 2500, 4000)]);
    bans = await listActiveBans(db);
    expect([...bans.momentIds].sort()).toEqual(['mom_new', 'mom_touch']);

    await includeRange(db, { assetId: 'ast_r', startMs: 2000, endMs: 5000 });
    bans = await listActiveBans(db);
    expect(bans.momentIds.size).toBe(0);
  });
});
