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
import { banMoment, listFeedbackEvents } from '@memetize/feedback';
import { listJobsForEntity } from '@memetize/job-system';
import { Timeline } from '@memetize/timeline';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type SwapClipError, swapClip } from './swap';
import { insertTimelineVersion, listTimelineVersions } from './timeline';

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
      endMs: 2000,
      durationMs: 2000,
      description: 'first take',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    },
    {
      id: 'mom_swap_b',
      sceneId: 'scn_swap_1',
      assetId: 'ast_swap_1',
      startMs: 2000,
      endMs: 4000,
      durationMs: 2000,
      description: 'second take',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    },
    {
      id: 'mom_swap_wide',
      sceneId: 'scn_swap_1',
      assetId: 'ast_swap_1',
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      description: 'whole take',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    },
    {
      id: 'mom_swap_short',
      sceneId: 'scn_swap_1',
      assetId: 'ast_swap_1',
      startMs: 1000,
      endMs: 2500,
      durationMs: 1500,
      description: 'short take',
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
      { momentId: 'mom_swap_short', assetId: 'ast_swap_1', finalScore: 0.6, penalties: [] },
      { momentId: 'mom_swap_wide', assetId: 'ast_swap_1', finalScore: 0.5, penalties: [] },
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
        source: { assetId: 'ast_swap_1', startMs: 0, endMs: 2000 },
        transform: { scale: 1, positionX: 0.5, positionY: 0.5, cropMode: 'cover' },
        effects: [{ type: 'zoom', startMs: 1350, endMs: 2000, from: 1, to: 1.12 }],
        reason: { segmentId: 'nar_swap_1', semanticScore: 0.8, finalScore: 0.9 },
      },
    ],
  });
}

/**
 * Two clips out of the same wide moment, joined by a resolved 500 ms
 * crossfade: clip 1 has 1,500 ms of tail handle and clip 2 has 1,000 ms of
 * head handle inside `mom_swap_wide`.
 */
function timelineWithCrossfade(projectId: string) {
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
        momentId: 'mom_swap_wide',
        timeline: { startMs: 0, endMs: 2000 },
        source: { assetId: 'ast_swap_1', startMs: 500, endMs: 2500 },
        effects: [],
        direction: { clipStyle: 'none', transitionOut: 'crossfade' },
        transitionOut: { style: 'crossfade', durationMs: 500, requested: 'crossfade' },
        reason: { segmentId: 'nar_swap_1', semanticScore: 0.8, finalScore: 0.5 },
      },
      {
        id: 'clp_swap_2',
        momentId: 'mom_swap_wide',
        timeline: { startMs: 2000, endMs: 4000 },
        source: { assetId: 'ast_swap_1', startMs: 1000, endMs: 3000 },
        effects: [],
        transitionOut: { style: 'hard', durationMs: 0, requested: 'hard' },
        reason: { segmentId: 'nar_swap_1', semanticScore: 0.8, finalScore: 0.5 },
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

    const { timeline: next, events } = await swapClip(db, {
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
    expect(clip?.source).toEqual({ assetId: 'ast_swap_1', startMs: 2000, endMs: 4000 });
    expect(clip?.timeline).toEqual({ startMs: 0, endMs: 2000 });
    expect(clip?.effects).toEqual([
      { type: 'zoom', startMs: 1350, endMs: 2000, from: 1, to: 1.12 },
    ]);
    expect(clip?.reason.finalScore).toBe(0.7);

    // Editorial memory: the swap is recorded as a rejected/accepted pair with
    // the segment context, and both get a FEEDBACK_EMBED job.
    expect(events.map((event) => [event.kind, event.momentId])).toEqual([
      ['SWAP_OUT', 'mom_swap_a'],
      ['SWAP_IN', 'mom_swap_b'],
    ]);
    for (const event of events) {
      expect(event).toMatchObject({
        projectId,
        timelineVersion: 2,
        clipId: 'clp_swap_1',
        segmentId: 'nar_swap_1',
        assetId: 'ast_swap_1',
        source: 'USER',
      });
      expect(event.context).toMatchObject({
        segmentId: 'nar_swap_1',
        narrativeFunction: 'payoff',
        emotion: 'joy',
        visualIdeas: ['hello'],
        retrieved: [],
      });
    }
    const persisted = await listFeedbackEvents(db, { projectId });
    expect(persisted).toHaveLength(2);
    const jobs = await Promise.all(events.map((event) => listJobsForEntity(db, event.id)));
    expect(jobs.flat().map((job) => job.type)).toEqual(['FEEDBACK_EMBED', 'FEEDBACK_EMBED']);
  });

  it('re-resolves cut styles so a swap never leaves a crossfade without a handle', async () => {
    const projectId = 'prj_swap_cuts';
    await seedSwapFixture(db, projectId);
    await insertTimelineVersion(db, {
      projectId,
      data: timelineWithCrossfade(projectId),
      director: 'fixture',
      directorVersion: '1.2.0',
      promptVersion: 'v4',
      timingOptimizer: 'heuristic',
      timingOptimizerVersion: '1.0.0',
      effectsPlanner: 'heuristic',
      effectsPlannerVersion: '1.2.0',
    });

    // mom_swap_a spans exactly [0, 2000]: once clip 1 uses it there is no
    // tail handle left, so the crossfade must fall back to a dip to black.
    const { timeline: next } = await swapClip(db, {
      projectId,
      clipId: 'clp_swap_1',
      momentId: 'mom_swap_a',
    });

    const [first, second] = next.data.clips;
    expect(first?.momentId).toBe('mom_swap_a');
    expect(first?.source).toEqual({ assetId: 'ast_swap_1', startMs: 0, endMs: 2000 });
    expect(first?.direction).toEqual({ clipStyle: 'none', transitionOut: 'crossfade' });
    expect(first?.transitionOut).toEqual({
      style: 'dip_black',
      durationMs: 250,
      requested: 'crossfade',
      downgradeReason: 'no_source_handle',
    });
    expect(second?.transitionOut).toEqual({ style: 'hard', durationMs: 0, requested: 'hard' });
    expect(first?.timeline).toEqual({ startMs: 0, endMs: 2000 });
    expect(second?.timeline).toEqual({ startMs: 2000, endMs: 4000 });
  });

  it('rejects a banned moment before touching the timeline', async () => {
    const projectId = 'prj_swap_banned';
    await seedSwapFixture(db, projectId);
    await insertTimelineVersion(db, {
      projectId,
      data: timelineWithClip(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });
    await banMoment(db, { momentId: 'mom_swap_b', assetId: 'ast_swap_1' });

    await expect(
      swapClip(db, { projectId, clipId: 'clp_swap_1', momentId: 'mom_swap_b' }),
    ).rejects.toMatchObject({ code: 'MOMENT_BANNED' } satisfies Partial<SwapClipError>);
    expect(await listTimelineVersions(db, projectId)).toHaveLength(1);
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

  it('rejects a shortlisted moment that is shorter than the existing slot', async () => {
    const projectId = 'prj_swap_short';
    await seedSwapFixture(db, projectId);
    await insertTimelineVersion(db, {
      projectId,
      data: timelineWithClip(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    await expect(
      swapClip(db, {
        projectId,
        clipId: 'clp_swap_1',
        momentId: 'mom_swap_short',
      }),
    ).rejects.toMatchObject({ code: 'MOMENT_TOO_SHORT' } satisfies Partial<SwapClipError>);
    expect(await listTimelineVersions(db, projectId)).toHaveLength(1);
  });

  it('rejects a swap when the project has no timeline', async () => {
    const projectId = 'prj_swap_empty';
    await seedSwapFixture(db, projectId);

    await expect(
      swapClip(db, { projectId, clipId: 'clp_swap_1', momentId: 'mom_swap_b' }),
    ).rejects.toMatchObject({ code: 'NO_TIMELINE' });
  });

  it('refuses a swap based on a stale timeline version and writes nothing (F09)', async () => {
    const projectId = 'prj_swap_conflict';
    await seedSwapFixture(db, projectId);
    await insertTimelineVersion(db, {
      projectId,
      data: timelineWithClip(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    // Another editor already produced v2; this swap was decided against v1.
    await swapClip(db, { projectId, clipId: 'clp_swap_1', momentId: 'mom_swap_b' });
    await expect(
      swapClip(db, {
        projectId,
        clipId: 'clp_swap_1',
        momentId: 'mom_swap_wide',
        expectedTimelineVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<SwapClipError>);

    // Nothing from the refused swap leaked: still two versions, two swap events, two jobs.
    expect(await listTimelineVersions(db, projectId)).toHaveLength(2);
    expect(await listFeedbackEvents(db, { projectId })).toHaveLength(2);
    expect(await listJobsForEntity(db, projectId)).toHaveLength(0);

    // The same swap against the version actually on screen goes through.
    const ok = await swapClip(db, {
      projectId,
      clipId: 'clp_swap_1',
      momentId: 'mom_swap_wide',
      expectedTimelineVersion: 2,
    });
    expect(ok.timeline.version).toBe(3);
  });
});
