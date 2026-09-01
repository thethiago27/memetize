import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_ANALYZER_DIR } from '@memetize/audio-analyzer';
import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { Orchestrator, ResourceScheduler } from '@memetize/orchestrator';
import {
  getAudioAnalysis,
  getLatestTimeline,
  getLyrics,
  getProject,
  ingestProject,
  listNarrativeSegments,
  listSegmentMatches,
} from '@memetize/projects';
import type { AppConfig } from '@memetize/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRegistry } from './registry';

const execFileAsync = promisify(execFile);
const handle = await createTestDatabase();
const db = handle?.db as Database;

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}
const ffmpegAvailable = await hasFfmpeg();
const pyEnvReady = existsSync(join(AUDIO_ANALYZER_DIR, '.venv'));

async function makeSilentClip(path: string, durationSeconds: number): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=44100:cl=mono:d=${durationSeconds}`,
    path,
  ]);
}

describe.skipIf(!handle || !ffmpegAvailable || !pyEnvReady)('project pipeline (e2e)', () => {
  let tmp: string;
  let config: AppConfig;
  let orchestrator: Orchestrator;
  let fixture: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'memetize-project-e2e-'));
    config = {
      databaseUrl: 'unused',
      testDatabaseUrl: null,
      rootDir: tmp,
      storageDir: join(tmp, 'storage'),
      storageDirRelative: 'storage',
      resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
      embeddingDimensions: 384,
      providers: {
        transcription: { kind: 'fixture', model: null },
        vision: { kind: 'fixture', model: null },
        llm: { kind: 'fixture', model: null },
        embedding: { kind: 'fixture', model: null },
        audio: { kind: 'fixture', model: null },
      },
    };
    orchestrator = new Orchestrator({
      db,
      config,
      registry: buildRegistry(),
      scheduler: new ResourceScheduler(config.resources),
    });
    fixture = join(tmp, 'song.mp3');
    await makeSilentClip(fixture, 6);
    await truncateAll(db);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('ingests an instrumental track and produces a musical + semantic timeline', async () => {
    const { project } = await ingestProject({ db, config, filePath: fixture });

    const outcomes = await orchestrator.drain({ entityId: project.id });
    const types = outcomes.map((outcome) => outcome.job.type);
    // AUDIO_ANALYZE and LYRICS fan out in parallel (relative order unspecified);
    // NARRATIVE only runs once both are done, then chains into MATCH, then
    // DIRECTOR, then TIMING, then EFFECTS (spec sections 32-33).
    expect(types).toHaveLength(5);
    expect(new Set(types.slice(0, 2))).toEqual(new Set(['AUDIO_ANALYZE', 'LYRICS']));
    expect(types[2]).toBe('NARRATIVE');
    expect(types[3]).toBe('MATCH');
    expect(types[4]).toBe('DIRECTOR');
    expect(outcomes.slice(0, 4).every((outcome) => outcome.status === 'COMPLETED')).toBe(true);
    expect(outcomes[4]?.status).toBe('FAILED');
    expect(outcomes[4]?.error?.code).toBe('INSUFFICIENT_CATALOG');

    const refreshed = await getProject(db, project.id);
    expect(refreshed?.status).toBe('FAILED');

    const audio = await getAudioAnalysis(db, project.id);
    expect(audio).toBeTruthy();
    expect(audio?.sections.length).toBeGreaterThanOrEqual(1);
    expect(audio?.beats.length).toBeGreaterThanOrEqual(1);
    for (const beat of audio?.beats ?? []) {
      expect(Number.isInteger(beat.timeMs)).toBe(true);
    }

    // Silent clip, no --lyrics: a successful, empty (instrumental) fixture.
    const lyrics = await getLyrics(db, project.id);
    expect(lyrics?.source).toBe('FIXTURE');
    expect(lyrics?.lines).toEqual([]);

    // Instrumental narrative falls back to one segment per musical section.
    const narrative = await listNarrativeSegments(db, project.id);
    expect(narrative.length).toBeGreaterThanOrEqual(1);
    for (const segment of narrative) {
      expect(segment.visualIdeas.length).toBeGreaterThan(0);
      expect(Number.isInteger(segment.startMs)).toBe(true);
      expect(Number.isInteger(segment.endMs)).toBe(true);
      expect(segment.endMs).toBeLessThanOrEqual(audio?.durationMs ?? 0);
    }

    // No catalog seeded in this test: MATCH still completes successfully,
    // with one (empty) shortlist row per narrative segment (spec section 30's
    // "catálogo vazio não é falha").
    const matches = await listSegmentMatches(db, project.id);
    expect(matches).toHaveLength(narrative.length);
    for (const match of matches) {
      expect(match.shortlist).toEqual([]);
    }

    expect(await getLatestTimeline(db, project.id)).toBeUndefined();

    // Re-ingesting the same bytes creates a *different* project (spec section 41 note).
    const again = await ingestProject({ db, config, filePath: fixture });
    expect(again.project.id).not.toBe(project.id);

    // Re-draining the first project processes nothing (jobs already terminal).
    const more = await orchestrator.drain({ entityId: project.id });
    expect(more).toHaveLength(0);
  }, 60_000);

  it('uses a user-supplied .lrc file for lyrics-driven narrative segments', async () => {
    const lyricsPath = join(tmp, 'song.lrc');
    await writeFile(
      lyricsPath,
      ['[00:00.00]hello from the fixture', '[00:03.00]this is the payoff line'].join('\n'),
    );

    const { project } = await ingestProject({ db, config, filePath: fixture, lyricsPath });
    await orchestrator.drain({ entityId: project.id });

    const lyrics = await getLyrics(db, project.id);
    expect(lyrics?.source).toBe('USER');
    expect(lyrics?.lines).toHaveLength(2);
    expect(lyrics?.lines[0]?.text).toBe('hello from the fixture');

    const narrative = await listNarrativeSegments(db, project.id);
    expect(narrative).toHaveLength(2);
    expect(narrative[0]?.lyrics).toBe('hello from the fixture');
    expect(narrative[0]?.narrativeFunction).toBe('setup');
    expect(narrative[1]?.narrativeFunction).toBe('payoff');
  }, 60_000);
});
