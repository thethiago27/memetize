import { describe, expect, it } from 'vitest';
import { parseRange } from './media';

describe('parseRange', () => {
  it('is null without a header or with a shape it does not serve', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('items=0-10', 100)).toBeNull();
    expect(parseRange('bytes=0-10,20-30', 100)).toBeNull();
  });

  it('serves an open-ended range to the end of the file', () => {
    expect(parseRange('bytes=40-', 100)).toEqual({ start: 40, end: 99 });
  });

  it('clamps the end to the file size', () => {
    expect(parseRange('bytes=0-500', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-20', 100)).toEqual({ start: 10, end: 20 });
  });

  it('serves a suffix range', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('rejects ranges nothing in the file can satisfy', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=30-20', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
    expect(parseRange('bytes=-0', 100)).toBe('invalid');
    expect(parseRange('bytes=0-', 0)).toBe('invalid');
  });
});
