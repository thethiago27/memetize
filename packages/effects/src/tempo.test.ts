import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAT_MS } from './constants';
import { beatMsFromBpm } from './tempo';

describe('beatMsFromBpm', () => {
  it('converts tempo to an integer beat length', () => {
    expect(beatMsFromBpm(120)).toBe(500);
    expect(beatMsFromBpm(128)).toBe(469);
  });

  it('falls back to the default beat when tempo is missing or nonsense', () => {
    expect(beatMsFromBpm(undefined)).toBe(DEFAULT_BEAT_MS);
    expect(beatMsFromBpm(0)).toBe(DEFAULT_BEAT_MS);
    expect(beatMsFromBpm(-90)).toBe(DEFAULT_BEAT_MS);
    expect(beatMsFromBpm(Number.NaN)).toBe(DEFAULT_BEAT_MS);
  });
});
