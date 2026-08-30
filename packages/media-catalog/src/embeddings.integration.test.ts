import {
  createTestDatabase,
  type Database,
  mediaAssets,
  moments,
  scenes,
  truncateAll,
} from '@memetize/database';
import { EMBEDDING_DIMENSIONS } from '@memetize/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listEmbeddingsForAsset, replaceEmbeddings } from './embeddings';

const handle = await createTestDatabase();
const db = handle?.db as Database;

function vec(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(seed + i));
}

async function seedMoment(db: Database): Promise<{ assetId: string; momentId: string }> {
  const assetId = 'ast_embed_test';
  await db.insert(mediaAssets).values({
    id: assetId,
    filename: 'clip.mp4',
    originalPath: 'storage/assets/ast_embed_test/original.mp4',
    checksum: 'checksum-embed-test',
  });
  const sceneId = 'scn_embed_test';
  await db.insert(scenes).values({
    id: sceneId,
    assetId,
    startMs: 0,
    endMs: 1000,
    durationMs: 1000,
    detector: 'test',
    detectorVersion: '1.0.0',
  });
  const momentId = 'mom_embed_test';
  await db.insert(moments).values({
    id: momentId,
    sceneId,
    assetId,
    startMs: 0,
    endMs: 1000,
    durationMs: 1000,
    description: 'test moment',
    extractor: 'test',
    extractorVersion: '1.0.0',
  });
  return { assetId, momentId };
}

describe.skipIf(!handle)('replaceEmbeddings (integration)', () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('replaces embeddings for the same asset/model/modelVersion instead of duplicating them', async () => {
    const { assetId, momentId } = await seedMoment(db);

    const first = await replaceEmbeddings(db, {
      assetId,
      model: 'fixture',
      modelVersion: '1.0.0',
      embeddings: [
        { momentId, assetId, embeddingType: 'MEME', sourceText: 'a', vector: vec(1) },
        { momentId, assetId, embeddingType: 'VISUAL', sourceText: 'b', vector: vec(2) },
      ],
    });
    expect(first).toHaveLength(2);

    const second = await replaceEmbeddings(db, {
      assetId,
      model: 'fixture',
      modelVersion: '1.0.0',
      embeddings: [
        { momentId, assetId, embeddingType: 'MEME', sourceText: 'a-updated', vector: vec(3) },
        { momentId, assetId, embeddingType: 'VISUAL', sourceText: 'b', vector: vec(2) },
        { momentId, assetId, embeddingType: 'NARRATIVE', sourceText: 'c', vector: vec(4) },
      ],
    });
    expect(second).toHaveLength(3);

    // Re-running never accumulates rows: three types in, three rows out.
    const all = await listEmbeddingsForAsset(db, assetId);
    expect(all).toHaveLength(3);
    const meme = all.find((row) => row.embeddingType === 'MEME');
    expect(meme?.sourceText).toBe('a-updated');
  });

  it('leaves rows from a different model/modelVersion untouched', async () => {
    const { assetId, momentId } = await seedMoment(db);

    await replaceEmbeddings(db, {
      assetId,
      model: 'fixture',
      modelVersion: '1.0.0',
      embeddings: [{ momentId, assetId, embeddingType: 'MEME', sourceText: 'a', vector: vec(1) }],
    });
    await replaceEmbeddings(db, {
      assetId,
      model: 'fixture',
      modelVersion: '2.0.0',
      embeddings: [
        { momentId, assetId, embeddingType: 'MEME', sourceText: 'a-v2', vector: vec(2) },
      ],
    });

    const all = await listEmbeddingsForAsset(db, assetId);
    expect(all).toHaveLength(2);
  });
});
