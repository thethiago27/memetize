import { describe, expect, it } from 'vitest';
import { assetId, jobId, prefixedId, sceneId } from './ids';

describe('ids', () => {
  it('produces prefixed ids', () => {
    expect(assetId()).toMatch(/^ast_[0-9a-z]{21}$/);
    expect(sceneId()).toMatch(/^scn_[0-9a-z]{21}$/);
    expect(jobId()).toMatch(/^job_[0-9a-z]{21}$/);
  });

  it('is collision-resistant across many ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => prefixedId('ast')));
    expect(ids.size).toBe(1000);
  });
});
