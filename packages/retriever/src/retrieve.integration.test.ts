import {
  createTestDatabase,
  type Database,
  mediaAssets,
  momentEmbeddings,
  moments,
  scenes,
  truncateAll,
} from '@memetize/database';
import { recordFeedbackEvents, upsertFeedbackEmbedding } from '@memetize/feedback';
import { FixtureEmbeddingProvider } from '@memetize/model-providers';
import type { AppConfig } from '@memetize/shared';
import { EMBEDDING_DIMENSIONS } from '@memetize/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { retrieveForSegment } from './retrieve';

const handle = await createTestDatabase();
const db = handle?.db as Database;

const config: AppConfig = {
  databaseUrl: 'unused',
  testDatabaseUrl: null,
  rootDir: '/tmp',
  storageDir: '/tmp/storage',
  storageDirRelative: 'storage',
  resources: { CPU_LIGHT: 4, CPU_HEAVY: 1, GPU: 1, IO: 4, RENDER: 1 },
  embeddingDimensions: EMBEDDING_DIMENSIONS,
  providerMode: 'demo',
  providers: {
    transcription: { kind: 'fixture', model: null },
    vision: { kind: 'fixture', model: null },
    llm: { kind: 'fixture', model: null },
    embedding: { kind: 'fixture', model: null },
    audio: { kind: 'fixture', model: null },
  },
};

const provider = new FixtureEmbeddingProvider(config.embeddingDimensions);

async function seedAsset(db: Database, id: string): Promise<void> {
  await db.insert(mediaAssets).values({
    id,
    filename: `${id}.mp4`,
    originalPath: `storage/assets/${id}/original.mp4`,
    checksum: `checksum-${id}`,
    status: 'READY',
  });
  await db.insert(scenes).values({
    id: `scn_${id}`,
    assetId: id,
    startMs: 0,
    endMs: 1000,
    durationMs: 1000,
    detector: 'test',
    detectorVersion: '1.0.0',
  });
}

async function seedMomentWithMemeText(
  db: Database,
  params: { id: string; assetId: string; description: string; memeText: string },
): Promise<void> {
  await db.insert(moments).values({
    id: params.id,
    sceneId: `scn_${params.assetId}`,
    assetId: params.assetId,
    startMs: 0,
    endMs: 1000,
    durationMs: 1000,
    description: params.description,
    extractor: 'test',
    extractorVersion: '1.0.0',
  });
  const { vectors, model, modelVersion } = await provider.embed([params.memeText]);
  const [vector] = vectors;
  if (!vector) throw new Error('expected a vector');
  await db.insert(momentEmbeddings).values({
    id: `emb_${params.id}`,
    momentId: params.id,
    assetId: params.assetId,
    embeddingType: 'MEME',
    sourceText: params.memeText,
    embedding: vector,
    model,
    modelVersion,
  });
}

describe.skipIf(!handle)('retrieveForSegment (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('surfaces the moment whose MEME vector matches a visualIdea exactly, with score 1', async () => {
    await seedAsset(db, 'ast_1');
    await seedMomentWithMemeText(db, {
      id: 'mom_1',
      assetId: 'ast_1',
      description: 'false confidence moment',
      memeText: 'false confidence',
    });
    await seedMomentWithMemeText(db, {
      id: 'mom_2',
      assetId: 'ast_1',
      description: 'unrelated moment',
      memeText: 'someone falling down stairs',
    });

    const candidates = await retrieveForSegment(db, config, {
      visualIdeas: ['false confidence', 'celebrating too early'],
      emotion: 'confidence',
      narrativeFunction: 'setup',
    });

    const top = candidates[0];
    expect(top?.momentId).toBe('mom_1');
    expect(top?.semanticScore).toBeCloseTo(1, 5);
  });

  it('unions candidates across visualIdeas without duplicating a momentId', async () => {
    await seedAsset(db, 'ast_2');
    await seedMomentWithMemeText(db, {
      id: 'mom_3',
      assetId: 'ast_2',
      description: 'moment matching idea B',
      memeText: 'celebrating too early',
    });

    const candidates = await retrieveForSegment(db, config, {
      visualIdeas: ['false confidence', 'celebrating too early'],
      emotion: 'confidence',
      narrativeFunction: 'setup',
    });

    const matches = candidates.filter((candidate) => candidate.momentId === 'mom_3');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.semanticScore).toBeCloseTo(1, 5);
  });

  it('falls back to emotion/narrativeFunction when visualIdeas is empty', async () => {
    await seedAsset(db, 'ast_3');
    await seedMomentWithMemeText(db, {
      id: 'mom_4',
      assetId: 'ast_3',
      description: 'a defensive reaction',
      memeText: 'defensive',
    });

    const candidates = await retrieveForSegment(db, config, {
      visualIdeas: [],
      emotion: 'defensive',
      narrativeFunction: 'escalation',
    });

    expect(candidates.some((candidate) => candidate.momentId === 'mom_4')).toBe(true);
  });

  it('excludes banned moments and assets, and moments rejected from this segment', async () => {
    await seedAsset(db, 'ast_ban');
    await seedAsset(db, 'ast_ok');
    await seedMomentWithMemeText(db, {
      id: 'mom_banned',
      assetId: 'ast_ok',
      description: 'banned',
      memeText: 'false confidence',
    });
    await seedMomentWithMemeText(db, {
      id: 'mom_rejected',
      assetId: 'ast_ok',
      description: 'rejected here',
      memeText: 'false confidence',
    });
    await seedMomentWithMemeText(db, {
      id: 'mom_on_banned_asset',
      assetId: 'ast_ban',
      description: 'asset banned',
      memeText: 'false confidence',
    });
    await seedMomentWithMemeText(db, {
      id: 'mom_kept',
      assetId: 'ast_ok',
      description: 'kept',
      memeText: 'false confidence',
    });

    const candidates = await retrieveForSegment(
      db,
      config,
      { visualIdeas: ['false confidence'], emotion: 'confidence', narrativeFunction: 'setup' },
      {
        exclude: { momentIds: ['mom_banned'], assetIds: ['ast_ban'] },
        rejectedMomentIds: new Set(['mom_rejected']),
      },
    );
    expect(candidates.map((candidate) => candidate.momentId)).toEqual(['mom_kept']);
  });

  it('merges POSITIVE feedback vectors as candidates and flags NEGATIVE matches', async () => {
    await seedAsset(db, 'ast_fb');
    await seedMomentWithMemeText(db, {
      id: 'mom_learned',
      assetId: 'ast_fb',
      description: 'catalog text says something else',
      memeText: 'a dog sleeping',
    });
    await seedMomentWithMemeText(db, {
      id: 'mom_rejected_like_this',
      assetId: 'ast_fb',
      description: 'catalog match',
      memeText: 'celebrating too early',
    });
    const [positive, negative] = await recordFeedbackEvents(db, [
      { kind: 'SWAP_IN', source: 'USER', momentId: 'mom_learned', assetId: 'ast_fb' },
      {
        kind: 'SWAP_OUT',
        source: 'USER',
        momentId: 'mom_rejected_like_this',
        assetId: 'ast_fb',
      },
    ]);
    if (!positive || !negative) throw new Error('seed failed');
    const { vectors, model, modelVersion } = await provider.embed(['celebrating too early']);
    const [vector] = vectors;
    if (!vector) throw new Error('expected a vector');
    await upsertFeedbackEmbedding(db, {
      feedbackEventId: positive.id,
      momentId: 'mom_learned',
      assetId: 'ast_fb',
      polarity: 'POSITIVE',
      sourceText: 'celebrating too early',
      vector,
      model,
      modelVersion,
    });
    await upsertFeedbackEmbedding(db, {
      feedbackEventId: negative.id,
      momentId: 'mom_rejected_like_this',
      assetId: 'ast_fb',
      polarity: 'NEGATIVE',
      sourceText: 'celebrating too early',
      vector,
      model,
      modelVersion,
    });

    const candidates = await retrieveForSegment(db, config, {
      visualIdeas: ['celebrating too early'],
      emotion: 'confidence',
      narrativeFunction: 'setup',
    });
    const learned = candidates.find((candidate) => candidate.momentId === 'mom_learned');
    expect(learned?.source).toBe('FEEDBACK');
    expect(learned?.semanticScore).toBeCloseTo(1, 5);
    expect(learned?.negativeScore).toBe(0);

    const flagged = candidates.find((candidate) => candidate.momentId === 'mom_rejected_like_this');
    expect(flagged?.source).toBe('CATALOG');
    expect(flagged?.negativeScore).toBeCloseTo(1, 5);
  });

  it('returns no candidates when the catalog is empty, without throwing', async () => {
    const candidates = await retrieveForSegment(db, config, {
      visualIdeas: ['anything'],
      emotion: 'neutral',
      narrativeFunction: 'setup',
    });
    expect(candidates).toEqual([]);
  });
});
