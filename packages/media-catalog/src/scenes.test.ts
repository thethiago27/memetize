import { describe, expect, it } from 'vitest';
import { toSceneRows } from './scenes';

describe('toSceneRows', () => {
  it('computes duration and preserves integer ms', () => {
    const rows = toSceneRows({
      assetId: 'ast_1',
      detector: 'pyscenedetect-content',
      detectorVersion: '1.0.0',
      scenes: [
        { startMs: 0, endMs: 3240 },
        { startMs: 3240, endMs: 8120 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      assetId: 'ast_1',
      startMs: 0,
      endMs: 3240,
      durationMs: 3240,
      detector: 'pyscenedetect-content',
      detectorVersion: '1.0.0',
    });
    expect(rows[1]?.durationMs).toBe(4880);
    expect(rows[0]?.id).toMatch(/^scn_/);
  });

  it('rejects non-integer (float) times', () => {
    expect(() =>
      toSceneRows({
        assetId: 'ast_1',
        detector: 'd',
        detectorVersion: '1',
        scenes: [{ startMs: 0, endMs: 3.333 }],
      }),
    ).toThrow(TypeError);
  });
});
