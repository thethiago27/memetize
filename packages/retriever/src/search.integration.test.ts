import {
  createTestDatabase,
  type Database,
  mediaAssets,
  momentEmbeddings,
  moments,
  scenes,
  truncateAll,
} from '@memetize/database';
import { FixtureEmbeddingProvider } from '@memetize/model-providers';
import type { AppConfig } from '@memetize/shared';
import { EMBEDDING_DIMENSIONS } from '@memetize/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { searchMoments } from './search';

const handle = await createTestDatabase();
const db = handle?.db as Database;

const config: AppConfig = {
  databaseUrl: 'unused',
  testDatabaseUrl: null,
  rootDir: '/tmp',
  storageDir: '/tmp/storage',
  storageDirRelative: 'storage',
  apiPort: 8787,
  jobMaintenanceIntervalMs: 30_000,
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

async function seedAsset(db: Database, id: string, status: 'READY' | 'INDEXING'): Promise<void> {
  await db.insert(mediaAssets).values({
    id,
    filename: `${id}.mp4`,
    originalPath: `storage/assets/${id}/original.mp4`,
    checksum: `checksum-${id}`,
    status,
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

async function seedMoment(
  db: Database,
  params: { id: string; assetId: string; description: string; embeddingType: 'MEME' | 'VISUAL' },
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
  const { vectors, model, modelVersion } = await provider.embed([params.description]);
  const [vector] = vectors;
  if (!vector) throw new Error('expected a vector');
  await db.insert(momentEmbeddings).values({
    id: `emb_${params.id}_${params.embeddingType}`,
    momentId: params.id,
    assetId: params.assetId,
    embeddingType: params.embeddingType,
    sourceText: params.description,
    embedding: vector,
    model,
    modelVersion,
  });
}

describe.skipIf(!handle)('searchMoments (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('ranks the exact textual match first, with a near-perfect score', async () => {
    await seedAsset(db, 'ast_1', 'READY');
    await seedMoment(db, {
      id: 'mom_1',
      assetId: 'ast_1',
      description: 'a person laughing uncontrollably',
      embeddingType: 'MEME',
    });
    await seedMoment(db, {
      id: 'mom_2',
      assetId: 'ast_1',
      description: 'a person crying quietly',
      embeddingType: 'MEME',
    });

    const hits = await searchMoments(db, config, {
      query: 'a person laughing uncontrollably',
      limit: 5,
    });
    expect(hits[0]?.momentId).toBe('mom_1');
    expect(hits[0]?.score).toBeCloseTo(1, 5);
  });

  it('only matches embeddings of the requested type', async () => {
    await seedAsset(db, 'ast_2', 'READY');
    await seedMoment(db, {
      id: 'mom_3',
      assetId: 'ast_2',
      description: 'shared description',
      embeddingType: 'VISUAL',
    });

    const hits = await searchMoments(db, config, {
      query: 'shared description',
      type: 'MEME',
      limit: 5,
    });
    expect(hits).toHaveLength(0);
  });

  it('excludes moments belonging to a non-READY asset', async () => {
    await seedAsset(db, 'ast_3', 'INDEXING');
    await seedMoment(db, {
      id: 'mom_4',
      assetId: 'ast_3',
      description: 'still indexing',
      embeddingType: 'MEME',
    });

    const hits = await searchMoments(db, config, { query: 'still indexing', limit: 5 });
    expect(hits).toHaveLength(0);
  });
});
