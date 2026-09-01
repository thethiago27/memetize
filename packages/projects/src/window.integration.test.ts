import type { EditWindowSelection } from '@memetize/contracts';
import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getLatestEditWindow, insertEditWindow, listEditWindows } from './window';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProject(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'PLANNING' });
}

function selection(sourceStartMs: number): EditWindowSelection {
  return {
    sourceStartMs,
    sourceEndMs: sourceStartMs + 60_000,
    durationMs: 60_000,
    targetDurationMs: 60_000,
    score: 0.8,
    scoreBreakdown: { section: 1, energy: 0.8, lyrics: 0.7, narrativeArc: 0.7, boundaries: 0.8 },
    selector: 'structural-highlight',
    selectorVersion: '1.0.0',
  };
}

describe.skipIf(!handle)('insertEditWindow / getLatestEditWindow (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('versions windows per project and returns the latest selection', async () => {
    await seedProject(db, 'prj_window_a');
    await seedProject(db, 'prj_window_b');
    const first = await insertEditWindow(db, { projectId: 'prj_window_a', selection: selection(0) });
    const second = await insertEditWindow(db, {
      projectId: 'prj_window_a',
      selection: selection(30_000),
    });
    const other = await insertEditWindow(db, { projectId: 'prj_window_b', selection: selection(0) });
    expect([first.version, second.version, other.version]).toEqual([1, 2, 1]);
    expect((await getLatestEditWindow(db, 'prj_window_a'))?.sourceStartMs).toBe(30_000);
    expect((await listEditWindows(db, 'prj_window_a')).map((row) => row.version)).toEqual([2, 1]);
  });
});
