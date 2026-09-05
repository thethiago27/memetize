import type { MomentRow, SegmentMatchRow } from '@memetize/database';
import type { ActiveBans } from '@memetize/feedback';
import { describe, expect, it } from 'vitest';
import { filterBannedCandidates } from './bans';

function moment(id: string, assetId: string): MomentRow {
  return { id, assetId } as MomentRow;
}

function match(segmentId: string, momentIds: string[]): SegmentMatchRow {
  const entries = momentIds.map((momentId) => ({ momentId, assetId: 'a', finalScore: 1 }));
  return {
    segmentId,
    shortlist: entries.map((e) => ({ ...e, penalties: [] })),
    ranked: entries,
  } as unknown as SegmentMatchRow;
}

function bans(overrides: Partial<ActiveBans> = {}): ActiveBans {
  return {
    momentIds: new Set(),
    assetIds: new Set(),
    excludedRanges: new Map(),
    ...overrides,
  };
}

describe('filterBannedCandidates (F13)', () => {
  const moments = [moment('m1', 'ast_a'), moment('m2', 'ast_b'), moment('m3', 'ast_a')];
  const matches = [match('seg_1', ['m1', 'm2', 'm3'])];

  it('drops a directly banned moment from the lookup and every match list', () => {
    const result = filterBannedCandidates(moments, matches, bans({ momentIds: new Set(['m2']) }));
    expect([...result.momentById.keys()]).toEqual(['m1', 'm3']);
    expect(result.matches[0]?.shortlist.map((e) => e.momentId)).toEqual(['m1', 'm3']);
    expect(result.matches[0]?.ranked.map((e) => e.momentId)).toEqual(['m1', 'm3']);
  });

  it('drops every moment of a banned asset', () => {
    const result = filterBannedCandidates(moments, matches, bans({ assetIds: new Set(['ast_a']) }));
    // m1 and m3 belong to ast_a; only m2 (ast_b) survives.
    expect([...result.momentById.keys()]).toEqual(['m2']);
    expect(result.matches[0]?.shortlist.map((e) => e.momentId)).toEqual(['m2']);
  });

  it('leaves an eligible universe untouched', () => {
    const result = filterBannedCandidates(moments, matches, bans());
    expect([...result.momentById.keys()]).toEqual(['m1', 'm2', 'm3']);
  });
});
