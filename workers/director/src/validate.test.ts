import { describe, expect, it } from 'vitest';
import { DirectorInvalidPickError, validatePicks } from './validate';

function shortlists(entries: Record<string, string[]>): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    Object.entries(entries).map(([segmentId, momentIds]) => [segmentId, new Set(momentIds)]),
  );
}

describe('validatePicks', () => {
  it('accepts a pick whose moment is in that segment shortlist', () => {
    expect(() =>
      validatePicks(
        [{ segmentId: 'nar_1', momentId: 'mom_a' }],
        shortlists({ nar_1: ['mom_a', 'mom_b'] }),
      ),
    ).not.toThrow();
  });

  it('accepts a segment with a non-empty shortlist that received no pick', () => {
    expect(() => validatePicks([], shortlists({ nar_1: ['mom_a'] }))).not.toThrow();
  });

  it('rejects a moment that is not in that segment shortlist, even if it is in another segment', () => {
    expect(() =>
      validatePicks(
        [{ segmentId: 'nar_1', momentId: 'mom_b' }],
        shortlists({ nar_1: ['mom_a'], nar_2: ['mom_b'] }),
      ),
    ).toThrow(DirectorInvalidPickError);
  });

  it('rejects a pick against an unknown segment', () => {
    expect(() =>
      validatePicks([{ segmentId: 'nar_missing', momentId: 'mom_a' }], shortlists({})),
    ).toThrow(/unknown segment/);
  });

  it('rejects a pick against a segment with an empty shortlist', () => {
    expect(() =>
      validatePicks([{ segmentId: 'nar_1', momentId: 'mom_a' }], shortlists({ nar_1: [] })),
    ).toThrow(/empty shortlist/);
  });

  it('rejects a second pick for the same segment', () => {
    expect(() =>
      validatePicks(
        [
          { segmentId: 'nar_1', momentId: 'mom_a' },
          { segmentId: 'nar_1', momentId: 'mom_b' },
        ],
        shortlists({ nar_1: ['mom_a', 'mom_b'] }),
      ),
    ).toThrow(/more than one pick/);
  });
});
