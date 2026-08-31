import { describe, expect, it } from 'vitest';
import { EffectsInput, EffectsOutput } from './effects';

describe('effects contracts', () => {
  it('parses an effects input with just a projectId', () => {
    expect(EffectsInput.safeParse({ projectId: 'prj_1' }).success).toBe(true);
  });

  it('requires a positive version and a non-negative clipsWithEffects count', () => {
    expect(
      EffectsOutput.safeParse({ projectId: 'prj_1', version: 1, clipsWithEffects: 0 }).success,
    ).toBe(true);
    expect(
      EffectsOutput.safeParse({ projectId: 'prj_1', version: 0, clipsWithEffects: 0 }).success,
    ).toBe(false);
    expect(
      EffectsOutput.safeParse({ projectId: 'prj_1', version: 1, clipsWithEffects: -1 }).success,
    ).toBe(false);
  });
});
