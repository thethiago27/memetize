import { describe, expect, it } from 'vitest';
import { toMomentRows } from './moments';

describe('toMomentRows', () => {
  it('computes duration and preserves integer ms', () => {
    const rows = toMomentRows({
      assetId: 'ast_1',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
      moments: [
        {
          sceneId: 'scn_1',
          startMs: 0,
          endMs: 2000,
          description: 'realization',
          primaryEmotion: 'surprise',
          emotionIntensity: 0.8,
          visualEnergy: 0.5,
          qualityScore: 0.9,
          metadata: {},
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      assetId: 'ast_1',
      sceneId: 'scn_1',
      startMs: 0,
      endMs: 2000,
      durationMs: 2000,
      description: 'realization',
      extractor: 'fixture',
      extractorVersion: '1.0.0',
    });
    expect(rows[0]?.id).toMatch(/^mom_/);
  });

  it('rejects non-integer (float) times', () => {
    expect(() =>
      toMomentRows({
        assetId: 'ast_1',
        extractor: 'fixture',
        extractorVersion: '1.0.0',
        moments: [
          {
            sceneId: 'scn_1',
            startMs: 0,
            endMs: 1000.5,
            description: 'x',
            primaryEmotion: null,
            emotionIntensity: null,
            visualEnergy: null,
            qualityScore: null,
            metadata: {},
          },
        ],
      }),
    ).toThrow(TypeError);
  });
});
