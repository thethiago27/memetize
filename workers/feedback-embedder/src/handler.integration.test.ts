import { createTestDatabase, type Database, truncateAll } from '@memetize/database';
import { listFeedbackEmbeddingsForMoment, recordFeedbackEvents } from '@memetize/feedback';
import type { JobContext } from '@memetize/orchestrator';
import { createLogger, loadConfig } from '@memetize/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFeedbackEmbedHandler } from './handler';

const handle = await createTestDatabase();
const db = handle?.db as Database;

function contextFor(feedbackEventId: string): JobContext {
  return {
    job: {
      id: 'job_test',
      type: 'FEEDBACK_EMBED',
      entityId: feedbackEventId,
      status: 'RUNNING',
      payload: { feedbackEventId },
    } as unknown as JobContext['job'],
    db,
    config: loadConfig({ ...process.env, EMBEDDING_PROVIDER: 'fixture' }),
    logger: createLogger(),
    enqueue: async () => {
      throw new Error('not expected');
    },
  };
}

describe.skipIf(!handle)('FEEDBACK_EMBED handler', () => {
  beforeEach(() => truncateAll(db));
  afterAll(async () => {
    await handle?.close();
  });

  it('embeds a swap event with the fixture provider and is idempotent', async () => {
    const [event] = await recordFeedbackEvents(db, [
      {
        kind: 'SWAP_IN',
        source: 'USER',
        projectId: 'prj_1',
        momentId: 'mom_1',
        assetId: 'ast_1',
        context: { visualIdeas: ['cat jumps'], meaning: 'release', lyrics: 'la' },
      },
    ]);
    if (!event) throw new Error('seed failed');
    const handler = createFeedbackEmbedHandler();
    const first = await handler(contextFor(event.id));
    expect(first).toMatchObject({ embedded: true, polarity: 'POSITIVE', model: 'fixture' });
    await handler(contextFor(event.id));
    const rows = await listFeedbackEmbeddingsForMoment(db, 'mom_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feedbackEventId: event.id,
      polarity: 'POSITIVE',
      sourceText: 'cat jumps\nrelease\nla',
    });
    expect(rows[0]?.embedding).toHaveLength(384);
  });

  it('skips kinds that carry no vector and events with empty text', async () => {
    const [note, swap] = await recordFeedbackEvents(db, [
      { kind: 'NOTE', source: 'USER', note: 'hi' },
      { kind: 'SWAP_OUT', source: 'USER', momentId: 'mom_2', assetId: 'ast_1', context: {} },
    ]);
    if (!note || !swap) throw new Error('seed failed');
    const handler = createFeedbackEmbedHandler();
    expect(await handler(contextFor(note.id))).toMatchObject({ embedded: false, polarity: null });
    expect(await handler(contextFor(swap.id))).toMatchObject({
      embedded: false,
      polarity: 'NEGATIVE',
    });
    expect(await listFeedbackEmbeddingsForMoment(db, 'mom_2')).toHaveLength(0);
  });
});
