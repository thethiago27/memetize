import { describe, expect, it } from 'vitest';
import { resolveBans } from './bans';
import type { FeedbackEventLike } from './types';

function event(partial: Partial<FeedbackEventLike> & { kind: FeedbackEventLike['kind'] }) {
  return {
    id: partial.id ?? `fb_${Math.random()}`,
    seq: 0,
    projectId: null,
    timelineVersion: null,
    clipId: null,
    segmentId: null,
    momentId: null,
    assetId: null,
    value: null,
    note: null,
    context: {},
    source: 'USER' as const,
    createdAt: new Date(0),
    ...partial,
  };
}

describe('resolveBans', () => {
  it('lets the latest ban or unban per id win', () => {
    const bans = resolveBans([
      event({ kind: 'BAN_MOMENT', momentId: 'mom_a', assetId: 'ast_1' }),
      event({ kind: 'BAN_MOMENT', momentId: 'mom_b', assetId: 'ast_1' }),
      event({ kind: 'UNBAN_MOMENT', momentId: 'mom_a', assetId: 'ast_1' }),
      event({ kind: 'BAN_ASSET', assetId: 'ast_2' }),
      event({ kind: 'UNBAN_ASSET', assetId: 'ast_2' }),
      event({ kind: 'BAN_ASSET', assetId: 'ast_2' }),
    ]);
    expect([...bans.momentIds]).toEqual(['mom_b']);
    expect([...bans.assetIds]).toEqual(['ast_2']);
  });

  it('keeps excluded ranges per asset until an INCLUDE with the same bounds', () => {
    const bans = resolveBans([
      event({ kind: 'EXCLUDE_RANGE', assetId: 'ast_1', context: { startMs: 0, endMs: 2000 } }),
      event({ kind: 'EXCLUDE_RANGE', assetId: 'ast_1', context: { startMs: 5000, endMs: 6000 } }),
      event({ kind: 'INCLUDE_RANGE', assetId: 'ast_1', context: { startMs: 0, endMs: 2000 } }),
      event({ kind: 'EXCLUDE_RANGE', assetId: 'ast_2', context: { startMs: 10, endMs: 5 } }),
    ]);
    expect(bans.excludedRanges.get('ast_1')).toEqual([{ startMs: 5000, endMs: 6000 }]);
    expect(bans.excludedRanges.has('ast_2')).toBe(false);
  });

  it('ignores non-ban kinds', () => {
    const bans = resolveBans([event({ kind: 'SWAP_OUT', momentId: 'mom_a', assetId: 'ast_1' })]);
    expect(bans.momentIds.size).toBe(0);
    expect(bans.assetIds.size).toBe(0);
  });
});
