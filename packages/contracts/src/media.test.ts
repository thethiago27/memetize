import { describe, expect, it } from 'vitest';
import { MomentCandidate, SceneInterval, TranscriptOutput, VisionSceneAnalysis } from './media';

describe('media contracts', () => {
  it('rejects float milliseconds in a scene interval (spec section 4.4)', () => {
    expect(SceneInterval.safeParse({ startMs: 0, endMs: 1500 }).success).toBe(true);
    expect(SceneInterval.safeParse({ startMs: 0.5, endMs: 1500 }).success).toBe(false);
    expect(SceneInterval.safeParse({ startMs: 0, endMs: 1500.2 }).success).toBe(false);
  });

  it('rejects float milliseconds in a moment candidate', () => {
    const base = {
      sceneId: 'scn_1',
      startMs: 0,
      endMs: 1000,
      description: 'setup',
      metadata: {},
    };
    expect(MomentCandidate.safeParse(base).success).toBe(true);
    expect(MomentCandidate.safeParse({ ...base, startMs: 0.1 }).success).toBe(false);
  });

  it('parses a transcript output with an empty segment list as valid', () => {
    const result = TranscriptOutput.safeParse({
      assetId: 'ast_1',
      segments: [],
      model: 'fixture',
      modelVersion: '1.0.0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects float word timestamps inside a transcript segment', () => {
    const result = TranscriptOutput.safeParse({
      assetId: 'ast_1',
      segments: [
        {
          startMs: 0,
          endMs: 1000,
          text: 'hi',
          words: [{ text: 'hi', startMs: 0.5, endMs: 900 }],
        },
      ],
      model: 'fixture',
      modelVersion: '1.0.0',
    });
    expect(result.success).toBe(false);
  });

  it('requires the two-level structured shape for a vision scene analysis', () => {
    const valid = VisionSceneAnalysis.safeParse({
      summary: 'a person looks confused',
      visualEnergy: 0.4,
      camera: { movement: 'static', shotType: 'medium' },
      memeFunctions: ['confusion'],
      quality: { usable: true, score: 0.9 },
    });
    expect(valid.success).toBe(true);

    const missingSummary = VisionSceneAnalysis.safeParse({
      visualEnergy: 0.4,
      camera: { movement: 'static', shotType: 'medium' },
      quality: { usable: true, score: 0.9 },
    });
    expect(missingSummary.success).toBe(false);
  });
});
