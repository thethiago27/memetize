import { describe, expect, it } from 'vitest';
import {
  clampWindow,
  formatField,
  lineAt,
  linesWithin,
  parseTimecode,
  snapToDownbeat,
  thin,
  toOutput,
  toPercent,
  toSource,
  windowProblem,
} from './analysis-time';

const window = { sourceStartMs: 30_000, sourceEndMs: 90_000 };

describe('toPercent', () => {
  it('maps a time to its fraction of the duration', () => {
    expect(toPercent(30_000, 120_000)).toBe(0.25);
  });

  it('clamps to [0, 1] and tolerates a zero duration', () => {
    expect(toPercent(-5, 100)).toBe(0);
    expect(toPercent(500, 100)).toBe(1);
    expect(toPercent(50, 0)).toBe(0);
  });
});

describe('toSource / toOutput', () => {
  it('round-trips inside the window', () => {
    const source = toSource(12_345, window);
    expect(source).toBe(42_345);
    expect(toOutput(source, window)).toBe(12_345);
  });

  it('returns null outside the window, inclusive at both edges', () => {
    expect(toOutput(29_999, window)).toBeNull();
    expect(toOutput(30_000, window)).toBe(0);
    expect(toOutput(90_000, window)).toBe(60_000);
    expect(toOutput(90_001, window)).toBeNull();
  });
});

describe('lineAt', () => {
  const lines = [
    { startMs: 0, endMs: 1000, text: 'a' },
    { startMs: 800, endMs: 2000, text: 'b' },
    { startMs: 3000, endMs: 4000, text: 'c' },
  ];

  it('returns the containing line', () => {
    expect(lineAt(lines, 3500)?.text).toBe('c');
  });

  it('prefers the first line when ranges overlap', () => {
    expect(lineAt(lines, 900)?.text).toBe('a');
  });

  it('returns null between lines and at an exclusive end', () => {
    expect(lineAt(lines, 2500)).toBeNull();
    expect(lineAt(lines, 4000)).toBeNull();
  });
});

describe('thin', () => {
  it('returns the input untouched when under the cap', () => {
    const items = [1, 2, 3];
    expect(thin(items, 5)).toEqual(items);
  });

  it('caps the count and keeps the first and last items', () => {
    const items = Array.from({ length: 10_001 }, (_, i) => i);
    const out = thin(items, 2000);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(10_000);
  });
});

describe('snapToDownbeat', () => {
  const downbeats = [0, 2000, 4000, 6000];

  it('snaps to the nearest downbeat within tolerance', () => {
    expect(snapToDownbeat(2300, downbeats, 500)).toBe(2000);
    expect(snapToDownbeat(3800, downbeats, 500)).toBe(4000);
  });

  it('leaves the value alone outside tolerance', () => {
    expect(snapToDownbeat(3000, downbeats, 500)).toBe(3000);
  });
});

describe('parseTimecode / formatField', () => {
  it('parses mm:ss and mm:ss.mmm', () => {
    expect(parseTimecode('01:30')).toBe(90_000);
    expect(parseTimecode('1:05.5')).toBe(65_500);
    expect(parseTimecode(' 00:00.250 ')).toBe(250);
  });

  it('rejects malformed values and seconds over 59', () => {
    expect(parseTimecode('90')).toBeNull();
    expect(parseTimecode('01:75')).toBeNull();
    expect(parseTimecode('a:b')).toBeNull();
  });

  it('formats whole seconds plainly and adds millis otherwise', () => {
    expect(formatField(90_000)).toBe('01:30');
    expect(formatField(65_500)).toBe('01:05.500');
  });

  it('round-trips through formatField', () => {
    for (const ms of [0, 250, 59_999, 65_500, 600_000]) {
      expect(parseTimecode(formatField(ms))).toBe(ms);
    }
  });
});

describe('clampWindow', () => {
  it('slides a band back into the track without changing its length', () => {
    expect(clampWindow({ startMs: -5000, endMs: 25_000 }, 100_000)).toEqual({
      startMs: 0,
      endMs: 30_000,
    });
    expect(clampWindow({ startMs: 90_000, endMs: 120_000 }, 100_000)).toEqual({
      startMs: 70_000,
      endMs: 100_000,
    });
  });

  it('caps a band longer than the track to the whole track', () => {
    expect(clampWindow({ startMs: -10, endMs: 200_000 }, 100_000)).toEqual({
      startMs: 0,
      endMs: 100_000,
    });
  });
});

describe('linesWithin / windowProblem', () => {
  const lines = [
    { startMs: 0, endMs: 1000 },
    { startMs: 1500, endMs: 2500 },
    { startMs: 5000, endMs: 6000 },
  ];

  it('counts lines overlapping the range', () => {
    expect(linesWithin(lines, 900, 5000)).toHaveLength(2);
    expect(linesWithin(lines, 1000, 1500)).toHaveLength(0);
  });

  it('names the rule a draft breaks', () => {
    expect(windowProblem({ startMs: 0, endMs: 4999 }, 100_000)).toBe('Mínimo de 5 segundos');
    expect(windowProblem({ startMs: 0, endMs: 30_001 }, 100_000)).toBe('Máximo de 30 segundos');
    expect(windowProblem({ startMs: 10, endMs: 10 }, 100_000)).toBe(
      'O fim precisa vir depois do início',
    );
    expect(windowProblem({ startMs: 0, endMs: 100_001 }, 100_000)).toBe('Fora da música');
    expect(windowProblem({ startMs: 0, endMs: 30_000 }, 100_000)).toBeNull();
  });
});
