import type { VisionSceneAnalysis } from '@memetize/contracts';
import { describe, expect, it } from 'vitest';
import { buildEmbeddingTexts, toEmbeddingRows } from './embeddings';

const vision: VisionSceneAnalysis = {
  summary: 'a person looks confused at the camera',
  subjects: [{ type: 'person', description: 'a confused man' }],
  actions: ['staring', 'blinking'],
  emotionTrajectory: [],
  visualEnergy: 0.4,
  camera: { movement: 'static', shotType: 'medium' },
  memeFunctions: ['confusion', 'disbelief'],
  quality: { usable: true, score: 0.8 },
};

describe('buildEmbeddingTexts', () => {
  it('produces all three types and includes moment description in MEME', () => {
    const texts = buildEmbeddingTexts(
      { description: 'realization moment', primaryEmotion: 'surprise', metadata: {} },
      vision,
    );
    expect(texts.VISUAL).toContain(vision.summary);
    expect(texts.VISUAL).toContain('confused man');
    expect(texts.MEME).toContain('realization moment');
    expect(texts.MEME).toContain('surprise');
    expect(texts.NARRATIVE).toContain('confusion');
  });

  it('prefers moment metadata memeFunctions over the scene vision when present', () => {
    const texts = buildEmbeddingTexts(
      {
        description: 'x',
        primaryEmotion: null,
        metadata: { memeFunctions: ['sarcasm'] },
      },
      vision,
    );
    expect(texts.MEME).toContain('sarcasm');
    expect(texts.MEME).not.toContain('confusion');
  });

  it('falls back to stable text when there is no vision analysis yet', () => {
    const texts = buildEmbeddingTexts(
      { description: 'plain moment', primaryEmotion: null, metadata: {} },
      null,
    );
    expect(texts.VISUAL).toBe('No visual description available.');
    expect(texts.MEME).toBe('plain moment');
    expect(texts.NARRATIVE).toBe('Reaction after the setup.');
  });

  it('produces stable strings for the same input (no randomness)', () => {
    const a = buildEmbeddingTexts({ description: 'x', primaryEmotion: null, metadata: {} }, vision);
    const b = buildEmbeddingTexts({ description: 'x', primaryEmotion: null, metadata: {} }, vision);
    expect(a).toEqual(b);
  });
});

describe('toEmbeddingRows', () => {
  it('builds one row per embedding input, prefixed ids and shared model metadata', () => {
    const rows = toEmbeddingRows({
      assetId: 'ast_1',
      model: 'fixture',
      modelVersion: '1.0.0',
      embeddings: [
        {
          momentId: 'mom_1',
          assetId: 'ast_1',
          embeddingType: 'MEME',
          sourceText: 'x',
          vector: [0.1, 0.2],
        },
        {
          momentId: 'mom_1',
          assetId: 'ast_1',
          embeddingType: 'VISUAL',
          sourceText: 'y',
          vector: [0.3, 0.4],
        },
      ],
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.id).toMatch(/^emb_/);
      expect(row.assetId).toBe('ast_1');
      expect(row.model).toBe('fixture');
      expect(row.modelVersion).toBe('1.0.0');
    }
    expect(rows[0]?.embedding).toEqual([0.1, 0.2]);
  });
});
