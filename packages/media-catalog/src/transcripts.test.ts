import { describe, expect, it } from 'vitest';
import { toTranscriptRows } from './transcripts';

describe('toTranscriptRows', () => {
  it('preserves integer ms and words', () => {
    const rows = toTranscriptRows({
      assetId: 'ast_1',
      model: 'fixture',
      modelVersion: '1.0.0',
      segments: [
        {
          startMs: 1200,
          endMs: 3800,
          text: 'No, God, please no!',
          words: [{ text: 'No', startMs: 1200, endMs: 1450 }],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      assetId: 'ast_1',
      startMs: 1200,
      endMs: 3800,
      text: 'No, God, please no!',
      model: 'fixture',
      modelVersion: '1.0.0',
    });
    expect(rows[0]?.id).toMatch(/^seg_/);
  });

  it('rejects non-integer (float) times', () => {
    expect(() =>
      toTranscriptRows({
        assetId: 'ast_1',
        model: 'fixture',
        modelVersion: '1.0.0',
        segments: [{ startMs: 0, endMs: 3.5, text: 'x', words: [] }],
      }),
    ).toThrow(TypeError);
  });

  it('builds an empty array for a silent clip', () => {
    expect(
      toTranscriptRows({ assetId: 'ast_1', model: 'fixture', modelVersion: '1.0.0', segments: [] }),
    ).toEqual([]);
  });
});
