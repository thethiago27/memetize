import { CLIP_STYLES, TRANSITION_STYLES } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { DIRECTOR_PROMPT_V3, DIRECTOR_PROMPT_V4, DIRECTOR_PROMPT_VERSION } from './director';

describe('DIRECTOR_PROMPT_V4', () => {
  it('is the current version and builds on v3', () => {
    expect(DIRECTOR_PROMPT_VERSION).toBe('v4');
    expect(DIRECTOR_PROMPT_V4.startsWith(DIRECTOR_PROMPT_V3)).toBe(true);
  });

  it('names every cut style in the closed vocabulary', () => {
    for (const style of [...TRANSITION_STYLES, ...CLIP_STYLES]) {
      expect(DIRECTOR_PROMPT_V4).toContain(`\`${style}\``);
    }
  });

  it('caps non-hard boundaries at one third and warns about downgrades', () => {
    expect(DIRECTOR_PROMPT_V4).toMatch(/at most one third/i);
    expect(DIRECTOR_PROMPT_V4).toMatch(/downgrade/i);
    expect(DIRECTOR_PROMPT_V4).toMatch(/do not try to predict source margins/i);
  });
});
