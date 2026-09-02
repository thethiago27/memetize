import { describe, expect, it } from 'vitest';
import { buildFeedbackText } from './text';

describe('buildFeedbackText', () => {
  it('joins visual ideas, meaning and lyrics on separate lines', () => {
    expect(
      buildFeedbackText({
        visualIdeas: ['cat jumps', ' dog stares '],
        meaning: 'release',
        lyrics: 'la la',
      }),
    ).toBe('cat jumps; dog stares\nrelease\nla la');
  });

  it('skips empty parts', () => {
    expect(buildFeedbackText({ visualIdeas: [], meaning: '', lyrics: 'only lyrics' })).toBe(
      'only lyrics',
    );
    expect(buildFeedbackText({})).toBe('');
  });
});
