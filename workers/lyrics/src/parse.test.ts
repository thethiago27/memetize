import { describe, expect, it } from 'vitest';
import { formatLrc, parseLrc, parseTextLines, segmentsToLyricLines } from './parse';

describe('parseLrc', () => {
  it('parses timestamps into integer startMs/endMs, ordered by time', () => {
    const content = ['[00:00.00]first line', '[00:02.50]second line', '[00:05.00]third line'].join(
      '\n',
    );
    const lines = parseLrc(content, 8000);

    expect(lines).toEqual([
      { startMs: 0, endMs: 2500, text: 'first line', words: [] },
      { startMs: 2500, endMs: 5000, text: 'second line', words: [] },
      { startMs: 5000, endMs: 8000, text: 'third line', words: [] },
    ]);
    for (const line of lines) {
      expect(Number.isInteger(line.startMs)).toBe(true);
      expect(Number.isInteger(line.endMs)).toBe(true);
    }
  });

  it('skips metadata tags and blank lyric lines', () => {
    const content = ['[ar:Some Artist]', '[00:00.00]', '[00:01.00]real line'].join('\n');
    const lines = parseLrc(content, 4000);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('real line');
  });

  it('clamps a timestamp beyond durationMs', () => {
    const content = '[00:10.00]too late';
    const lines = parseLrc(content, 4000);
    expect(lines).toEqual([{ startMs: 4000, endMs: 4000, text: 'too late', words: [] }]);
  });

  it('sorts out-of-order timestamps before deriving endMs', () => {
    const content = ['[00:03.00]second', '[00:01.00]first'].join('\n');
    const lines = parseLrc(content, 5000);
    expect(lines.map((line) => line.text)).toEqual(['first', 'second']);
    expect(lines[0]).toEqual({ startMs: 1000, endMs: 3000, text: 'first', words: [] });
  });
});

describe('formatLrc', () => {
  it('round-trips timed lines through parseLrc', () => {
    const content = formatLrc([
      { startMs: 0, text: 'first line' },
      { startMs: 2500, text: 'second line' },
      { startMs: 5000, text: 'third line' },
    ]);
    expect(content).toBe('[00:00.000]first line\n[00:02.500]second line\n[00:05.000]third line\n');
    expect(parseLrc(content, 8000)).toEqual([
      { startMs: 0, endMs: 2500, text: 'first line', words: [] },
      { startMs: 2500, endMs: 5000, text: 'second line', words: [] },
      { startMs: 5000, endMs: 8000, text: 'third line', words: [] },
    ]);
  });

  it('drops blank lines', () => {
    expect(formatLrc([{ startMs: 1000, text: '   ' }])).toBe('');
  });
});

describe('parseTextLines', () => {
  it('divides the duration evenly across non-empty lines', () => {
    const content = ['one', '', 'two', 'three', 'four'].join('\n');
    const lines = parseTextLines(content, 4000);

    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.text)).toEqual(['one', 'two', 'three', 'four']);
    expect(lines[0]).toEqual({ startMs: 0, endMs: 1000, text: 'one', words: [] });
    expect(lines[3]).toEqual({ startMs: 3000, endMs: 4000, text: 'four', words: [] });
    for (const line of lines) {
      expect(Number.isInteger(line.startMs)).toBe(true);
      expect(Number.isInteger(line.endMs)).toBe(true);
    }
  });

  it('returns no lines for empty/whitespace-only content', () => {
    expect(parseTextLines('   \n\n  ', 4000)).toEqual([]);
  });
});

describe('segmentsToLyricLines', () => {
  it('clamps transcript segments into lyric lines and drops empty text', () => {
    const lines = segmentsToLyricLines(
      [
        {
          startMs: 100,
          endMs: 900,
          text: '  first  ',
          words: [{ text: ' first', startMs: 100, endMs: 400 }],
        },
        { startMs: 1000, endMs: 2000, text: '   ', words: [] },
        { startMs: 5000, endMs: 6000, text: 'late', words: [] },
      ],
      4000,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      startMs: 100,
      endMs: 900,
      text: 'first',
      words: [{ text: 'first', startMs: 100, endMs: 400 }],
    });
    expect(lines[1]?.text).toBe('late');
    expect(lines[1]?.startMs).toBe(4000);
    expect(lines[1]?.endMs).toBe(4000);
  });
});
