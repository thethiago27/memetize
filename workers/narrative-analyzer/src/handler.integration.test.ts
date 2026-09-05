import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { selectEditWindow } from '@memetize/edit-planner';
import type { JobContext } from '@memetize/orchestrator';
import {
  getLatestEditWindow,
  getProject,
  listNarrativeSegments,
  replaceAudioAnalysis,
  replaceLyrics,
} from '@memetize/projects';
import { createLogger, loadConfig } from '@memetize/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createNarrativeHandler } from './handler';

const handle = await createTestDatabase();
const db = handle?.db as Database;

describe.skipIf(!handle)('narrative handler window coverage (integration)', () => {
  let storageDir: string;

  beforeEach(async () => {
    await truncateAll(db);
    storageDir = await mkdtemp(join(tmpdir(), 'memetize-narrative-'));
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('persists the selected window and covers it with contiguous narrative spans', async () => {
    const projectId = 'prj_narrative_window';
    await db
      .insert(projects)
      .values({ id: projectId, filename: 'song.mp3', status: 'ANALYZING_AUDIO' });

    const analysis = {
      durationMs: 120_000,
      bpm: 120,
      beats: [
        { timeMs: 0, strength: 0.2 },
        { timeMs: 60_000, strength: 1 },
      ],
      downbeats: [0, 60_000],
      sections: [
        { type: 'intro', startMs: 0, endMs: 60_000 },
        { type: 'chorus', startMs: 60_000, endMs: 120_000 },
      ],
      energyCurve: [
        { timeMs: 0, value: 0.1 },
        { timeMs: 60_000, value: 0.9 },
      ],
    };
    const lyrics = [{ startMs: 61_000, endMs: 63_000, text: 'hook', words: [] }];

    await replaceAudioAnalysis(db, {
      projectId,
      ...analysis,
      analyzer: 'fixture',
      analyzerVersion: '1.0.0',
    });
    await replaceLyrics(db, {
      projectId,
      source: 'FIXTURE',
      lines: lyrics,
      model: 'fixture',
      modelVersion: '1.0.0',
    });

    const expectedSelection = selectEditWindow({
      trackDurationMs: analysis.durationMs,
      sections: analysis.sections,
      beats: analysis.beats,
      downbeats: analysis.downbeats,
      energyCurve: analysis.energyCurve,
      lyrics,
    });

    const config = loadConfig({
      ...process.env,
      STORAGE_PATH: storageDir,
      LLM_PROVIDER: 'fixture',
    });
    const handler = createNarrativeHandler();
    await handler({
      job: {
        id: 'job_narrative_window',
        type: 'NARRATIVE',
        entityId: projectId,
        status: 'RUNNING',
        payload: { projectId },
        result: null,
        priority: 0,
        resourceClass: 'CPU_LIGHT',
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
      },
      db,
      config,
      logger: createLogger({ worker: 'narrative-test' }),
      enqueue: async () => ({ created: true, job: { id: 'job_match' } as never }),
    } as JobContext);

    const window = await getLatestEditWindow(db, projectId);
    const segments = await listNarrativeSegments(db, projectId);

    expect(window).toMatchObject({
      sourceStartMs: expectedSelection.sourceStartMs,
      sourceEndMs: expectedSelection.sourceEndMs,
      durationMs: expectedSelection.durationMs,
      version: 1,
    });
    expect(segments[0]?.startMs).toBe(window?.sourceStartMs);
    expect(segments.at(-1)?.endMs).toBe(window?.sourceEndMs);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index - 1]?.endMs).toBe(segments[index]?.startMs);
    }
    expect(segments.every((segment) => segment.endMs > segment.startMs)).toBe(true);

    await rm(storageDir, { recursive: true, force: true });
  });

  it('honors a manual window on the project instead of selecting one', async () => {
    const projectId = 'prj_narrative_manual';
    await db.insert(projects).values({
      id: projectId,
      filename: 'song.mp3',
      status: 'ANALYZING_AUDIO',
      manualWindowStartMs: 15_000,
      manualWindowEndMs: 45_000,
    });
    await replaceAudioAnalysis(db, {
      projectId,
      durationMs: 120_000,
      bpm: 120,
      beats: [
        { timeMs: 0, strength: 0.2 },
        { timeMs: 60_000, strength: 1 },
      ],
      downbeats: [0, 60_000],
      sections: [
        { type: 'intro', startMs: 0, endMs: 60_000 },
        { type: 'chorus', startMs: 60_000, endMs: 120_000 },
      ],
      energyCurve: [
        { timeMs: 0, value: 0.1 },
        { timeMs: 60_000, value: 0.9 },
      ],
      analyzer: 'fixture',
      analyzerVersion: '1.0.0',
    });
    await replaceLyrics(db, {
      projectId,
      source: 'FIXTURE',
      lines: [{ startMs: 20_000, endMs: 23_000, text: 'verse', words: [] }],
      model: 'fixture',
      modelVersion: '1.0.0',
    });

    const config = loadConfig({
      ...process.env,
      STORAGE_PATH: storageDir,
      LLM_PROVIDER: 'fixture',
    });
    const handler = createNarrativeHandler();
    await handler({
      job: {
        id: 'job_narrative_manual',
        type: 'NARRATIVE',
        entityId: projectId,
        status: 'RUNNING',
        payload: { projectId },
        result: null,
        priority: 0,
        resourceClass: 'CPU_LIGHT',
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
      },
      db,
      config,
      logger: createLogger({ worker: 'narrative-test' }),
      enqueue: async () => ({ created: true, job: { id: 'job_match' } as never }),
    } as JobContext);

    const window = await getLatestEditWindow(db, projectId);
    expect(window).toMatchObject({
      sourceStartMs: 15_000,
      sourceEndMs: 45_000,
      durationMs: 30_000,
      selector: 'manual',
    });
    const segments = await listNarrativeSegments(db, projectId);
    expect(segments[0]?.startMs).toBe(15_000);
    expect(segments.at(-1)?.endMs).toBe(45_000);
    expect(await getProject(db, projectId)).toMatchObject({ manualWindowStartMs: 15_000 });

    await rm(storageDir, { recursive: true, force: true });
  });
});
