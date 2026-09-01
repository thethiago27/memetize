import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import {
  getLatestRender,
  insertEditWindow,
  insertTimelineVersion,
  renderProject,
} from '@memetize/projects';
import { buildRegistry } from '@memetize/runtime';
import type { AppConfig } from '@memetize/shared';
import { Timeline } from '@memetize/timeline';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const handle = await createTestDatabase();
const db = handle?.db as Database;

const config: AppConfig = {
  databaseUrl: 'unused',
  testDatabaseUrl: null,
  rootDir: process.cwd(),
  storageDir: 'storage',
  storageDirRelative: 'storage',
  resources: { CPU_LIGHT: 1, CPU_HEAVY: 1, GPU: 1, IO: 1, RENDER: 1 },
  embeddingDimensions: 384,
  providers: {
    transcription: { kind: 'fixture', model: null },
    vision: { kind: 'fixture', model: null },
    llm: { kind: 'fixture', model: null },
    embedding: { kind: 'fixture', model: null },
    audio: { kind: 'fixture', model: null },
  },
};

describe.skipIf(!handle)('renderer selected-window guard (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('rejects a stale timeline before resolving media or spawning FFmpeg', async () => {
    const projectId = 'prj_render_stale_window';
    await db
      .insert(projects)
      .values({ id: projectId, filename: 'song.mp3', status: 'TIMELINE_READY' });
    await insertTimelineVersion(db, {
      projectId,
      data: Timeline.parse({
        projectId,
        durationMs: 1_000,
        audio: { path: 'storage/audio/missing.mp3', timelineStartMs: 0, sourceStartMs: 0 },
        clips: [
          {
            id: 'clp_stale',
            momentId: 'mom_stale',
            timeline: { startMs: 0, endMs: 1_000 },
            source: { assetId: 'ast_missing', startMs: 0, endMs: 1_000 },
            reason: { segmentId: 'nar_stale', semanticScore: 0.8, finalScore: 0.8 },
          },
        ],
      }),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });
    await insertEditWindow(db, {
      projectId,
      selection: {
        sourceStartMs: 0,
        sourceEndMs: 2_000,
        durationMs: 2_000,
        targetDurationMs: 2_000,
        score: 1,
        scoreBreakdown: {
          section: 1,
          energy: 1,
          lyrics: 1,
          narrativeArc: 1,
          boundaries: 1,
        },
        selector: 'fixture',
        selectorVersion: '1.0.0',
      },
    });

    await renderProject(db, projectId);
    const registry = buildRegistry();
    const orchestrator = new Orchestrator({
      db,
      config,
      registry: { RENDER: registry.RENDER },
      scheduler: new ResourceScheduler(config.resources),
    });
    const outcomes = await orchestrator.drain({ entityId: projectId });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      status: 'FAILED',
      error: { code: 'RENDER_INVALID_TIMELINE' },
    });
    expect(outcomes[0]?.error?.message).toContain('selected edit-window duration');
    expect(await getLatestRender(db, projectId)).toBeUndefined();
  });
});
