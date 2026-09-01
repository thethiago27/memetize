import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
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
