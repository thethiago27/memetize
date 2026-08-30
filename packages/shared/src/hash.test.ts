import { describe, expect, it } from 'vitest';
import { hashInput, sha256Hex } from './hash';

describe('hash', () => {
  it('hashes strings deterministically', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).toHaveLength(64);
  });

  it('is stable regardless of key order', () => {
    expect(hashInput({ a: 1, b: 2 })).toBe(hashInput({ b: 2, a: 1 }));
  });

  it('ignores undefined values', () => {
    expect(hashInput({ a: 1, b: undefined })).toBe(hashInput({ a: 1 }));
  });

  it('differs for different content', () => {
    expect(hashInput({ a: 1 })).not.toBe(hashInput({ a: 2 }));
  });
});
