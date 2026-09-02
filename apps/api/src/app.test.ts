import {
  createTestDatabase,
  type Database,
  mediaAssets,
  moments,
  projects,
  scenes,
  truncateAll,
} from '@memetize/database';
import { insertEditWindow, insertTimelineVersion } from '@memetize/projects';
import { createAppRuntime } from '@memetize/runtime';
import { loadConfig } from '@memetize/shared';
import { Timeline } from '@memetize/timeline';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi } from './app';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('studio API (inject)', () => {
  const runtime = createAppRuntime({
    config: loadConfig(),
    db,
    close: async () => undefined,
  });
  const appPromise = buildApi(runtime);

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
    await handle?.close();
  });

  it('returns the selected edit window on project detail', async () => {
    const app = await appPromise;
    const projectId = 'prj_api_window';
    await db.insert(projects).values({ id: projectId, filename: 'song.mp3', status: 'PLANNING' });
    await insertEditWindow(db, {
      projectId,
      selection: {
        sourceStartMs: 30_000,
        sourceEndMs: 90_000,
        durationMs: 60_000,
        targetDurationMs: 60_000,
        score: 0.8,
        scoreBreakdown: {
          section: 1,
          energy: 0.8,
          lyrics: 0.7,
          narrativeArc: 0.7,
          boundaries: 0.8,
        },
        selector: 'structural-highlight',
        selectorVersion: '1.0.0',
      },
    });

    const response = await app.inject({ method: 'GET', url: `/v1/projects/${projectId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().editWindow).toMatchObject({
      sourceStartMs: 30_000,
      sourceEndMs: 90_000,
      durationMs: 60_000,
      selector: 'structural-highlight',
      selectorVersion: '1.0.0',
    });
  });

  it('deletes a project and answers 404 for it afterwards', async () => {
    const app = await appPromise;
    const projectId = 'prj_api_delete';
    await db.insert(projects).values({ id: projectId, filename: 'song.mp3', status: 'CREATED' });

    const deleted = await app.inject({ method: 'DELETE', url: `/v1/projects/${projectId}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ ok: true });

    const missing = await app.inject({ method: 'DELETE', url: `/v1/projects/${projectId}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');

    const detail = await app.inject({ method: 'GET', url: `/v1/projects/${projectId}` });
    expect(detail.statusCode).toBe(404);
  });

  it('allows DELETE from the Studio origin in CORS preflight', async () => {
    const app = await appPromise;
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/projects/prj_any',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'DELETE',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('DELETE');
  });

  it('lists an empty project catalog', async () => {
    const app = await appPromise;
    const response = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ projects: [] });
  });

  it('returns 409 when swapping a moment that is not on the shortlist', async () => {
    const app = await appPromise;
    const projectId = 'prj_api_swap';
    await db
      .insert(projects)
      .values({ id: projectId, filename: 'song.mp3', status: 'TIMELINE_READY' });
    await insertTimelineVersion(db, {
      projectId,
      data: Timeline.parse({
        projectId,
        durationMs: 1000,
        audio: { path: 'storage/audio/x.mp3', timelineStartMs: 0, sourceStartMs: 0 },
        clips: [
          {
            id: 'clp_1',
            momentId: 'mom_a',
            timeline: { startMs: 0, endMs: 1000 },
            source: { assetId: 'ast_1', startMs: 0, endMs: 1000 },
            reason: { segmentId: 'nar_1', semanticScore: 0.5, finalScore: 0.5 },
          },
        ],
      }),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/clips/clp_1/swap`,
      payload: { momentId: 'mom_missing' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_IN_SHORTLIST');
  });

  it('records ratings, clip thumbs, notes, and lists them on project detail', async () => {
    const app = await appPromise;
    const projectId = 'prj_api_feedback';
    await db
      .insert(projects)
      .values({ id: projectId, filename: 'song.mp3', status: 'TIMELINE_READY' });
    await insertTimelineVersion(db, {
      projectId,
      data: Timeline.parse({
        projectId,
        durationMs: 1000,
        audio: { path: 'storage/audio/x.mp3', timelineStartMs: 0, sourceStartMs: 0 },
        clips: [
          {
            id: 'clp_1',
            momentId: 'mom_a',
            timeline: { startMs: 0, endMs: 1000 },
            source: { assetId: 'ast_1', startMs: 0, endMs: 1000 },
            reason: { segmentId: 'nar_1', semanticScore: 0.5, finalScore: 0.5 },
          },
        ],
      }),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    const rating = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/feedback`,
      payload: { kind: 'VIDEO_RATING', value: 5 },
    });
    expect(rating.statusCode).toBe(201);
    expect(rating.json().event).toMatchObject({ kind: 'VIDEO_RATING', value: 5 });

    const thumb = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/feedback`,
      payload: { kind: 'CLIP_DOWN', clipId: 'clp_1' },
    });
    expect(thumb.statusCode).toBe(201);
    expect(thumb.json().event).toMatchObject({ kind: 'CLIP_DOWN', momentId: 'mom_a' });

    const missing = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/feedback`,
      payload: { kind: 'CLIP_UP', clipId: 'clp_nope' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('CLIP_NOT_FOUND');

    const invalid = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/feedback`,
      payload: { kind: 'VIDEO_RATING', value: 9 },
    });
    expect(invalid.statusCode).toBe(400);

    const note = await app.inject({
      method: 'POST',
      url: '/v1/feedback/notes',
      payload: { note: 'shorter cuts on the drop' },
    });
    expect(note.statusCode).toBe(201);

    const detail = await app.inject({ method: 'GET', url: `/v1/projects/${projectId}` });
    expect(detail.json().feedback.map((event: { kind: string }) => event.kind)).toEqual([
      'NOTE',
      'CLIP_DOWN',
      'VIDEO_RATING',
    ]);

    const list = await app.inject({ method: 'GET', url: `/v1/feedback?projectId=${projectId}` });
    expect(list.json().events).toHaveLength(3);
  });

  it('bans and unbans assets and moments', async () => {
    const app = await appPromise;
    await db.insert(mediaAssets).values({
      id: 'ast_ban',
      filename: 'clip.mp4',
      originalPath: 'storage/assets/ast_ban/original.mp4',
      checksum: 'sum_ban',
      durationMs: 4000,
      status: 'READY',
    });
    await db.insert(scenes).values({
      id: 'scn_ban',
      assetId: 'ast_ban',
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      detector: 'fixture',
      detectorVersion: '1.0.0',
    });
    await db.insert(moments).values({
      id: 'mom_ban',
      sceneId: 'scn_ban',
      assetId: 'ast_ban',
      startMs: 0,
      endMs: 2000,
      durationMs: 2000,
      description: 'take',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    });

    expect(
      (await app.inject({ method: 'POST', url: '/v1/moments/mom_ban/ban', payload: {} }))
        .statusCode,
    ).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/v1/assets/ast_ban/ban' })).statusCode).toBe(
      201,
    );
    expect((await app.inject({ method: 'POST', url: '/v1/moments/mom_nope/ban' })).statusCode).toBe(
      404,
    );

    const bans = await app.inject({ method: 'GET', url: '/v1/feedback/bans' });
    expect(bans.json()).toEqual({ momentIds: ['mom_ban'], assetIds: ['ast_ban'] });

    const asset = await app.inject({ method: 'GET', url: '/v1/assets/ast_ban' });
    expect(asset.json().banned).toBe(true);
    expect(asset.json().moments[0].banned).toBe(true);

    expect((await app.inject({ method: 'DELETE', url: '/v1/assets/ast_ban/ban' })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: '/v1/assets/ast_ban' })).json().banned).toBe(
      false,
    );
  });

  it('excludes a source range of an asset and reports its moments as banned', async () => {
    const app = await appPromise;
    await db.insert(mediaAssets).values({
      id: 'ast_x',
      filename: 'clip.mp4',
      originalPath: 'storage/assets/ast_x/original.mp4',
      checksum: 'sum_x',
      durationMs: 6000,
      status: 'READY',
    });
    await db.insert(scenes).values({
      id: 'scn_x',
      assetId: 'ast_x',
      startMs: 0,
      endMs: 6000,
      durationMs: 6000,
      detector: 'fixture',
      detectorVersion: '1.0.0',
    });
    await db.insert(moments).values([
      {
        id: 'mom_x1',
        sceneId: 'scn_x',
        assetId: 'ast_x',
        startMs: 0,
        endMs: 2000,
        durationMs: 2000,
        description: 'a',
        extractor: 'fixture',
        extractorVersion: '1.0.0',
      },
      {
        id: 'mom_x2',
        sceneId: 'scn_x',
        assetId: 'ast_x',
        startMs: 3000,
        endMs: 5000,
        durationMs: 2000,
        description: 'b',
        extractor: 'fixture',
        extractorVersion: '1.0.0',
      },
    ]);

    const bad = await app.inject({
      method: 'POST',
      url: '/v1/assets/ast_x/exclusions',
      payload: { startMs: 5000, endMs: 1000 },
    });
    expect(bad.statusCode).toBe(400);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/assets/ast_x/exclusions',
      payload: { startMs: 2500, endMs: 6000 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().event).toMatchObject({ kind: 'EXCLUDE_RANGE', assetId: 'ast_x' });

    let detail = (await app.inject({ method: 'GET', url: '/v1/assets/ast_x' })).json();
    expect(detail.exclusions).toEqual([{ startMs: 2500, endMs: 6000 }]);
    expect(detail.moments.map((m: { id: string; banned: boolean }) => [m.id, m.banned])).toEqual([
      ['mom_x1', false],
      ['mom_x2', true],
    ]);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/v1/assets/ast_x/exclusions',
      payload: { startMs: 2500, endMs: 6000 },
    });
    expect(removed.statusCode).toBe(200);
    detail = (await app.inject({ method: 'GET', url: '/v1/assets/ast_x' })).json();
    expect(detail.exclusions).toEqual([]);
    expect(detail.moments[1].banned).toBe(false);
  });

  it('projects referenced moments with descriptions, asset names, and nearest frames', async () => {
    const app = await appPromise;
    const projectId = 'prj_api_moments';
    await db
      .insert(projects)
      .values({ id: projectId, filename: 'song.mp3', status: 'TIMELINE_READY' });
    await db.insert(mediaAssets).values({
      id: 'ast_m',
      filename: 'cat.mp4',
      originalPath: 'storage/assets/ast_m/original.mp4',
      thumbnailPath: 'storage/assets/ast_m/thumb.jpg',
      checksum: 'sum_m',
      durationMs: 4000,
      status: 'READY',
    });
    await db.insert(scenes).values({
      id: 'scn_m',
      assetId: 'ast_m',
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      detector: 'fixture',
      detectorVersion: '1.0.0',
      frames: [
        { timestampMs: 0, path: 'storage/frames/scn_m/0.jpg' },
        { timestampMs: 2000, path: 'storage/frames/scn_m/2000.jpg' },
      ],
    });
    await db.insert(moments).values({
      id: 'mom_m',
      sceneId: 'scn_m',
      assetId: 'ast_m',
      startMs: 1800,
      endMs: 3800,
      durationMs: 2000,
      description: 'cat stares at the camera',
      primaryEmotion: 'judgement',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    });
    await insertTimelineVersion(db, {
      projectId,
      data: Timeline.parse({
        projectId,
        durationMs: 2000,
        audio: { path: 'storage/audio/x.mp3', timelineStartMs: 0, sourceStartMs: 0 },
        clips: [
          {
            id: 'clp_1',
            momentId: 'mom_m',
            timeline: { startMs: 0, endMs: 2000 },
            source: { assetId: 'ast_m', startMs: 1800, endMs: 3800 },
            reason: { segmentId: 'nar_1', semanticScore: 0.5, finalScore: 0.5 },
          },
        ],
      }),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    const detail = await app.inject({ method: 'GET', url: `/v1/projects/${projectId}` });
    expect(detail.json().moments).toEqual({
      mom_m: {
        id: 'mom_m',
        assetId: 'ast_m',
        assetFilename: 'cat.mp4',
        description: 'cat stares at the camera',
        primaryEmotion: 'judgement',
        startMs: 1800,
        endMs: 3800,
        durationMs: 2000,
        thumbnailPath: 'storage/frames/scn_m/2000.jpg',
      },
    });
  });

  it('rejects a media path that tries to escape the repo', async () => {
    const app = await appPromise;
    // Fastify/light-my-request canonicalizes `/v1/media/../etc` before routing.
    // Encoded slashes keep `..` inside the media wildcard so the guard runs.
    const response = await app.inject({
      method: 'GET',
      url: '/v1/media/foo%2f..%2f..%2fetc/passwd',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_PATH');
  });
});
