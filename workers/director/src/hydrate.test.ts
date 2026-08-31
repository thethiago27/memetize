import { describe, expect, it } from 'vitest';
import { hydrateShortlist } from './hydrate';

describe('hydrateShortlist', () => {
  const live = {
    description: 'a reaction',
    durationMs: 1200,
    primaryEmotion: 'shock' as const,
  };

  it('keeps shortlist entries whose moments still exist', () => {
    const result = hydrateShortlist(
      [{ momentId: 'mom_a', assetId: 'ast_1', finalScore: 0.9, penalties: [] }],
      new Map([['mom_a', live]]),
    );
    expect(result).toEqual([
      {
        momentId: 'mom_a',
        assetId: 'ast_1',
        finalScore: 0.9,
        description: 'a reaction',
        durationMs: 1200,
        primaryEmotion: 'shock',
      },
    ]);
  });

  it('drops shortlist entries whose catalog moment is gone', () => {
    const result = hydrateShortlist(
      [
        { momentId: 'mom_deleted', assetId: 'ast_gone', finalScore: 0.95, penalties: [] },
        { momentId: 'mom_a', assetId: 'ast_1', finalScore: 0.4, penalties: [] },
      ],
      new Map([['mom_a', live]]),
    );
    expect(result.map((entry) => entry.momentId)).toEqual(['mom_a']);
  });

  it('yields an empty shortlist when every candidate was deleted', () => {
    expect(
      hydrateShortlist(
        [
          {
            momentId: 'mom_wgjqqah87dmi08hj5wfmk',
            assetId: 'ast_x',
            finalScore: 0.8,
            penalties: [],
          },
        ],
        new Map(),
      ),
    ).toEqual([]);
  });
});
