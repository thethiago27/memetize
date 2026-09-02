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

  it('ignores non-ban kinds', () => {
    const bans = resolveBans([event({ kind: 'SWAP_OUT', momentId: 'mom_a', assetId: 'ast_1' })]);
    expect(bans.momentIds.size).toBe(0);
    expect(bans.assetIds.size).toBe(0);
  });
});
