import {
  createTestDatabase,
  type Database,
  narrativeSegments,
  projects,
  segmentMatches,
  truncateAll,
} from '@memetize/database';
import { Timeline } from '@memetize/timeline';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addNote,
  listProjectFeedback,
  type ProjectFeedbackError,
  rateClip,
  rateProject,
} from './feedback';
import { insertTimelineVersion } from './timeline';

const handle = await createTestDatabase();
const db = handle?.db as Database;

async function seed(projectId: string): Promise<void> {
  await db
    .insert(projects)
    .values({ id: projectId, filename: 'song.mp3', status: 'TIMELINE_READY' });
  await db.insert(narrativeSegments).values({
    id: `nar_${projectId}`,
    projectId,
    startMs: 0,
    endMs: 2000,
    lyrics: 'hello',
    meaning: 'greeting',
    emotion: 'joy',
    narrativeFunction: 'setup',
    visualIdeas: ['wave'],
    literalness: 1,
    ironyPotential: 0,
    energy: 0.4,
    extractor: 'fixture',
    extractorVersion: '1.0.0',
  });
  await db.insert(segmentMatches).values({
    id: `mat_${projectId}`,
    projectId,
    segmentId: `nar_${projectId}`,
    retrieved: [
      {
        momentId: 'mom_x',
        assetId: 'ast_1',
        semanticScore: 0.9,
        source: 'CATALOG',
        negativeScore: 0,
      },
    ],
    ranked: [],
    shortlist: [],
    ranker: 'fixture',
    rankerVersion: '1.0.0',
  });
  await insertTimelineVersion(db, {
    projectId,
    data: Timeline.parse({
      projectId,
      durationMs: 2000,
      audio: {
        path: `storage/audio/${projectId}/original.mp3`,
        timelineStartMs: 0,
        sourceStartMs: 0,
      },
      clips: [
        {
          id: 'clp_1',
          momentId: 'mom_x',
          timeline: { startMs: 0, endMs: 2000 },
          source: { assetId: 'ast_1', startMs: 0, endMs: 2000 },
          reason: { segmentId: `nar_${projectId}`, semanticScore: 0.9, finalScore: 0.8 },
        },
      ],
    }),
    director: 'fixture',
    directorVersion: '1.0.0',
    promptVersion: 'v1',
  });
}

describe.skipIf(!handle)('project feedback helpers', () => {
  beforeEach(() => truncateAll(db));
  afterAll(async () => {
    await handle?.close();
  });

  it('rates the latest timeline with a placements snapshot', async () => {
    await seed('prj_rate');
    const row = await rateProject(db, { projectId: 'prj_rate', value: 4 });
    expect(row).toMatchObject({ kind: 'VIDEO_RATING', value: 4, timelineVersion: 1 });
    expect(row.context.placements).toEqual([
      { momentId: 'mom_x', segmentId: 'nar_prj_rate', narrativeFunction: 'setup' },
    ]);
  });

  it('records clip thumbs with the segment context and retrieval pool', async () => {
    await seed('prj_clip');
    const row = await rateClip(db, { projectId: 'prj_clip', clipId: 'clp_1', kind: 'CLIP_DOWN' });
    expect(row).toMatchObject({
      kind: 'CLIP_DOWN',
      momentId: 'mom_x',
      assetId: 'ast_1',
      segmentId: 'nar_prj_clip',
      clipId: 'clp_1',
    });
    expect(row.context).toMatchObject({ narrativeFunction: 'setup', visualIdeas: ['wave'] });
    expect(row.context.retrieved?.map((entry) => entry.momentId)).toEqual(['mom_x']);

    await expect(
      rateClip(db, { projectId: 'prj_clip', clipId: 'clp_missing', kind: 'CLIP_UP' }),
    ).rejects.toMatchObject({ code: 'CLIP_NOT_FOUND' } satisfies Partial<ProjectFeedbackError>);
  });

  it('fails to rate a project without a timeline', async () => {
    await db.insert(projects).values({ id: 'prj_empty', filename: 'x.mp3' });
    await expect(rateProject(db, { projectId: 'prj_empty', value: 5 })).rejects.toMatchObject({
      code: 'NO_TIMELINE',
    } satisfies Partial<ProjectFeedbackError>);
  });

  it('lists a project feedback newest first including global notes', async () => {
    await seed('prj_list');
    await addNote(db, { note: 'global rule' });
    await addNote(db, { projectId: 'prj_list', note: 'project rule' });
    await addNote(db, { projectId: 'prj_other', note: 'elsewhere' });
    await rateProject(db, { projectId: 'prj_list', value: 5 });
    const rows = await listProjectFeedback(db, 'prj_list');
    expect(rows.map((row) => row.note ?? row.kind)).toEqual([
      'VIDEO_RATING',
      'project rule',
      'global rule',
    ]);
  });
});
