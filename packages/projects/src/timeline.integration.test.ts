import { createTestDatabase, type Database, projects, truncateAll } from '@memetize/database';
import { Timeline } from '@memetize/timeline';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getLatestTimeline, insertTimelineVersion, listTimelineVersions } from './timeline';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seedProject(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'PLANNING' });
}

function timelineFor(projectId: string): Timeline {
  return Timeline.parse({
    projectId,
    durationMs: 4000,
    audio: {
      path: `storage/audio/${projectId}/original.mp3`,
      timelineStartMs: 0,
      sourceStartMs: 0,
    },
    clips: [],
  });
}

describe.skipIf(!handle)('insertTimelineVersion / getLatestTimeline (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('inserts version 1 for the first timeline of a project', async () => {
    const projectId = 'prj_timeline_v1';
    await seedProject(db, projectId);

    const row = await insertTimelineVersion(db, {
      projectId,
      data: timelineFor(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    expect(row.version).toBe(1);
    const latest = await getLatestTimeline(db, projectId);
    expect(latest?.id).toBe(row.id);
  });

  it('never overwrites an existing version: a second insert creates v2 and v1 is still readable', async () => {
    const projectId = 'prj_timeline_v2';
    await seedProject(db, projectId);

    const first = await insertTimelineVersion(db, {
      projectId,
      data: timelineFor(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });
    const second = await insertTimelineVersion(db, {
      projectId,
      data: timelineFor(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);

    const versions = await listTimelineVersions(db, projectId);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);

    const latest = await getLatestTimeline(db, projectId);
    expect(latest?.id).toBe(second.id);
  });

  it('serializes concurrent inserts into distinct versions under the entity lock (F09)', async () => {
    const projectId = 'prj_timeline_concurrent';
    await seedProject(db, projectId);

    const inserts = Array.from({ length: 5 }, () =>
      insertTimelineVersion(db, {
        projectId,
        data: timelineFor(projectId),
        director: 'fixture',
        directorVersion: '1.0.0',
        promptVersion: 'v1',
      }),
    );
    const rows = await Promise.all(inserts);
    const versions = rows.map((row) => row.version).sort((a, b) => a - b);
    // Every concurrent insert got a distinct version; none collided or failed.
    expect(versions).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps timelines from different projects on independent version counters', async () => {
    const a = 'prj_timeline_a';
    const b = 'prj_timeline_b';
    await seedProject(db, a);
    await seedProject(db, b);

    await insertTimelineVersion(db, {
      projectId: a,
      data: timelineFor(a),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });
    const firstB = await insertTimelineVersion(db, {
      projectId: b,
      data: timelineFor(b),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });

    expect(firstB.version).toBe(1);
  });

  it('returns undefined when the project has no timeline yet', async () => {
    const projectId = 'prj_timeline_none';
    await seedProject(db, projectId);
    expect(await getLatestTimeline(db, projectId)).toBeUndefined();
  });

  it('accepts optional effectsPlanner fields and stores omitted ones as null', async () => {
    const projectId = 'prj_timeline_effects';
    await seedProject(db, projectId);

    const omitted = await insertTimelineVersion(db, {
      projectId,
      data: timelineFor(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
    });
    expect(omitted.effectsPlanner).toBeNull();
    expect(omitted.effectsPlannerVersion).toBeNull();
    expect(omitted.timingOptimizer).toBeNull();
    expect(omitted.timingOptimizerVersion).toBeNull();

    const planned = await insertTimelineVersion(db, {
      projectId,
      data: timelineFor(projectId),
      director: 'fixture',
      directorVersion: '1.0.0',
      promptVersion: 'v1',
      timingOptimizer: 'heuristic',
      timingOptimizerVersion: '1.0.0',
      effectsPlanner: 'heuristic',
      effectsPlannerVersion: '1.0.0',
    });
    expect(planned.effectsPlanner).toBe('heuristic');
    expect(planned.effectsPlannerVersion).toBe('1.0.0');
    expect(planned.timingOptimizer).toBe('heuristic');
    expect(planned.timingOptimizerVersion).toBe('1.0.0');
  });
});
