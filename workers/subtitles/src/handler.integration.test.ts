import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import * as modelProviders from '@memetize/model-providers';
import { createDirectJobContext } from '@memetize/orchestrator';
import { getSubtitles, replaceLyrics } from '@memetize/projects';
import { createLogger, loadConfig } from '@memetize/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubtitlesHandler } from './handler';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('subtitles handler (integration)', () => {
  let storageDir: string;

  beforeEach(async () => {
    await truncateAll(db);
    storageDir = await mkdtemp(join(tmpdir(), 'memetize-subtitles-'));
  });

  afterAll(async () => {
    await handle?.close();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  function config() {
    return {
      ...loadConfig({ ...process.env, LLM_PROVIDER: 'fixture' }),
      rootDir: storageDir,
      storageDir: join(storageDir, 'storage'),
      storageDirRelative: 'storage',
    };
  }

  function job(projectId: string, id: string) {
    return {
      id,
      type: 'SUBTITLES' as const,
      entityId: projectId,
      status: 'RUNNING' as const,
      payload: { projectId },
      result: null,
      priority: 0,
      resourceClass: 'CPU_LIGHT' as const,
      attempts: 1,
      maxAttempts: 3,
      inputHash: 'hash',
      workerVersion: '1.0.0',
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      leaseToken: null,
      leaseExpiresAt: null,
      generationId: null,
      stepKey: null,
    };
  }

  it('persists fixture lines unchanged when the project has lyrics', async () => {
    const projectId = 'prj_subtitles_lines';
    await db.insert(projects).values({ id: projectId, filename: 'song.mp3', status: 'PLANNING' });
    await replaceLyrics(db, {
      projectId,
      source: 'USER',
      lines: [{ startMs: 0, endMs: 1500, text: 'hello world', words: [] }],
      model: 'lrc-parser',
      modelVersion: '1.0.0',
    });

    const handler = createSubtitlesHandler();
    const result = await handler(
      createDirectJobContext({
        job: job(projectId, 'job_sub_1'),
        db,
        config: config(),
        logger: createLogger({ worker: 'subtitles-test' }),
      }),
    );

    expect(result).toMatchObject({
      projectId,
      language: 'pt-BR',
      translated: false,
      lineCount: 1,
      model: 'fixture',
    });
    const row = await getSubtitles(db, projectId);
    expect(row?.lines).toEqual([{ startMs: 0, endMs: 1500, text: 'hello world' }]);
  });

  it('persists an empty row for an instrumental project without calling a model', async () => {
    const projectId = 'prj_subtitles_instrumental';
    await db.insert(projects).values({ id: projectId, filename: 'song.mp3', status: 'PLANNING' });
    await replaceLyrics(db, {
      projectId,
      source: 'FIXTURE',
      lines: [],
      model: 'fixture',
      modelVersion: '1.0.0',
    });

    const handler = createSubtitlesHandler();
    const result = await handler(
      createDirectJobContext({
        job: job(projectId, 'job_sub_2'),
        db,
        config: config(),
        logger: createLogger({ worker: 'subtitles-test' }),
      }),
    );

    expect(result).toMatchObject({
      lineCount: 0,
      translated: false,
      model: 'none',
    });
    const row = await getSubtitles(db, projectId);
    expect(row?.lines).toEqual([]);
  });

  it('fails when the project has no lyrics row', async () => {
    const projectId = 'prj_subtitles_missing';
    await db.insert(projects).values({ id: projectId, filename: 'song.mp3', status: 'PLANNING' });
    const handler = createSubtitlesHandler();
    await expect(
      handler(
        createDirectJobContext({
          job: job(projectId, 'job_sub_3'),
          db,
          config: config(),
          logger: createLogger({ worker: 'subtitles-test' }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'SUBTITLES_NO_LYRICS' });
  });

  it('fails retryably when the provider returns the wrong number of lines', async () => {
    const projectId = 'prj_subtitles_mismatch';
    await db.insert(projects).values({ id: projectId, filename: 'song.mp3', status: 'PLANNING' });
    await replaceLyrics(db, {
      projectId,
      source: 'USER',
      lines: [
        { startMs: 0, endMs: 1000, text: 'one', words: [] },
        { startMs: 1000, endMs: 2000, text: 'two', words: [] },
      ],
      model: 'lrc-parser',
      modelVersion: '1.0.0',
    });

    const spy = vi.spyOn(modelProviders, 'createProviders').mockReturnValue({
      llm: {
        translateLyrics: async () => ({
          lines: ['only-one'],
          sourceLanguage: 'en',
          translated: true,
          model: 'mock',
          modelVersion: '1.0.0',
          promptVersion: '1.0.0',
        }),
      },
    } as ReturnType<typeof modelProviders.createProviders>);

    try {
      const handler = createSubtitlesHandler();
      await expect(
        handler(
          createDirectJobContext({
            job: job(projectId, 'job_sub_4'),
            db,
            config: config(),
            logger: createLogger({ worker: 'subtitles-test' }),
          }),
        ),
      ).rejects.toMatchObject({ code: 'SUBTITLES_INVALID_OUTPUT', retryable: true });
    } finally {
      spy.mockRestore();
    }
  });
});
