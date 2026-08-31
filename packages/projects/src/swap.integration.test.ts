import {
  createTestDatabase,
  type Database,
  mediaAssets,
  moments,
  narrativeSegments,
  projects,
  scenes,
  segmentMatches,
  truncateAll,
} from '@memetize/database';
import { Timeline } from '@memetize/timeline';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type SwapClipError, swapClip } from './swap';
import { insertTimelineVersion } from './timeline';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedSwapFixture(db: Database, projectId: string): Promise<void> {
  await db
    .insert(projects)
    .values({ id: projectId, filename: 'song.mp3', status: 'TIMELINE_READY' });
  await db.insert(mediaAssets).values({
    id: 'ast_swap_1',
    filename: 'clip.mp4',
    originalPath: 'storage/assets/ast_swap_1/original.mp4',
    checksum: `sum_${projectId}`,
    durationMs: 4000,
    status: 'READY',
  });
  await db.insert(scenes).values({
    id: 'scn_swap_1',
    assetId: 'ast_swap_1',
    startMs: 0,
    endMs: 4000,
    durationMs: 4000,
    detector: 'fixture',
    detectorVersion: '1.0.0',
  });
  await db.insert(moments).values([
    {
      id: 'mom_swap_a',
      sceneId: 'scn_swap_1',
      assetId: 'ast_swap_1',
      startMs: 0,
      endMs: 1500,
      durationMs: 1500,
      description: 'first take',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    },
    {
      id: 'mom_swap_b',
      sceneId: 'scn_swap_1',
      assetId: 'ast_swap_1',
      startMs: 2000,
      endMs: 3800,
      durationMs: 1800,
      description: 'second take',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    },
  ]);
  await db.insert(narrativeSegments).values({
    id: 'nar_swap_1',
    projectId,
    startMs: 0,
    endMs: 2000,
    lyrics: 'hello',
    meaning: 'hello',
    emotion: 'joy',
    narrativeFunction: 'payoff',
    visualIdeas: ['hello'],
    literalness: 1,
    ironyPotential: 0,
    energy: 0.8,
    extractor: 'fixture',
    extractorVersion: '1.0.0',
  });
  await db.insert(segmentMatches).values({
    id: 'mat_swap_1',
    projectId,
    segmentId: 'nar_swap_1',
    retrieved: [],
    ranked: [],
    shortlist: [
      { momentId: 'mom_swap_a', assetId: 'ast_swap_1', finalScore: 0.9, penalties: [] },
      { momentId: 'mom_swap_b', assetId: 'ast_swap_1', finalScore: 0.7, penalties: [] },
    ],
    ranker: 'fixture',
    rankerVersion: '1.0.0',
  });
}

function timelineWithClip(projectId: string) {
  return Timeline.parse({
    projectId,
    durationMs: 4000,
    audio: {
      path: `storage/audio/${projectId}/original.mp3`,
      timelineStartMs: 0,
      sourceStartMs: 0,
    },
    clips: [
      {
        id: 'clp_swap_1',
        momentId: 'mom_swap_a',
        timeline: { startMs: 0, endMs: 2000 },
        source: { assetId: 'ast_swap_1', startMs: 0, endMs: 1500 },
        transform: { scale: 1, positionX: 0.5, positionY: 0.5, cropMode: 'cover' },
        effects: [{ type: 'zoom', startMs: 1350, endMs: 2000, from: 1, to: 1.12 }],
        reason: { segmentId: 'nar_swap_1', semanticScore: 0.8, finalScore: 0.9 },
      },
    ],
  });
}

describe.skipIf(!handle)('swapClip (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('writes a new timeline version with the shortlisted moment and a recalculated source', async () => {
    const projectId = 'prj_swap_ok';
    await seedSwapFixture(db, projectId);
    await insertTimelineVersion(db, {
      projectId,
      data: timelineWithClip(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
      timingOptimizer: 'heuristic',
      timingOptimizerVersion: '1.0.0',
      effectsPlanner: 'heuristic',
      effectsPlannerVersion: '1.0.0',
    });

    const next = await swapClip(db, {
      projectId,
      clipId: 'clp_swap_1',
      momentId: 'mom_swap_b',
    });

    expect(next.version).toBe(2);
    expect(next.director).toBe('user');
    expect(next.timingOptimizer).toBe('heuristic');
    expect(next.effectsPlanner).toBe('heuristic');

    const clip = next.data.clips[0];
    expect(clip?.momentId).toBe('mom_swap_b');
    expect(clip?.source).toEqual({ assetId: 'ast_swap_1', startMs: 2000, endMs: 3800 });
    expect(clip?.timeline).toEqual({ startMs: 0, endMs: 2000 });
    expect(clip?.effects).toEqual([
      { type: 'zoom', startMs: 1350, endMs: 2000, from: 1, to: 1.12 },
    ]);
    expect(clip?.reason.finalScore).toBe(0.7);
  });

  it('rejects a moment that is not on the segment shortlist', async () => {
    const projectId = 'prj_swap_shortlist';
    await seedSwapFixture(db, projectId);
    await insertTimelineVersion(db, {
      projectId,
      data: timelineWithClip(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    await expect(
      swapClip(db, { projectId, clipId: 'clp_swap_1', momentId: 'mom_missing' }),
    ).rejects.toMatchObject({ code: 'NOT_IN_SHORTLIST' } satisfies Partial<SwapClipError>);
  });

  it('rejects a swap when the project has no timeline', async () => {
    const projectId = 'prj_swap_empty';
    await seedSwapFixture(db, projectId);

    await expect(
      swapClip(db, { projectId, clipId: 'clp_swap_1', momentId: 'mom_swap_b' }),
    ).rejects.toMatchObject({ code: 'NO_TIMELINE' });
  });
});
