import { describe, expect, it } from 'vitest';
import { AudioSection, BeatPoint, EnergyPoint, LyricLine, NarrativeSegment } from './audio';
import { LyricSource } from './enums';

describe('audio pipeline contracts', () => {
  it('rejects float millisecond values on a beat point', () => {
    expect(BeatPoint.safeParse({ timeMs: 500, strength: 0.8 }).success).toBe(true);
    expect(BeatPoint.safeParse({ timeMs: 500.5, strength: 0.8 }).success).toBe(false);
  });

  it('rejects float millisecond bounds on a section', () => {
    expect(AudioSection.safeParse({ type: 'chorus', startMs: 0, endMs: 4000 }).success).toBe(true);
    expect(AudioSection.safeParse({ type: 'chorus', startMs: 0, endMs: 4000.2 }).success).toBe(
      false,
    );
  });

  it('rejects an energy point outside [0, 1]', () => {
    expect(EnergyPoint.safeParse({ timeMs: 0, value: 0.5 }).success).toBe(true);
    expect(EnergyPoint.safeParse({ timeMs: 0, value: 1.5 }).success).toBe(false);
  });

  it('parses a lyric line with empty words as instrumental-friendly default', () => {
    const result = LyricLine.safeParse({ startMs: 0, endMs: 1000, text: 'hello' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.words).toEqual([]);
  });

  it('rejects an invalid lyric source', () => {
    expect(LyricSource.safeParse('USER').success).toBe(true);
    expect(LyricSource.safeParse('WHISPER').success).toBe(false);
  });

  it('rejects a narrative segment with an out-of-range literalness score', () => {
    const base = {
      startMs: 0,
      endMs: 1000,
      lyrics: 'line',
      meaning: 'literal',
      emotion: 'joy',
      narrativeFunction: 'setup',
      visualIdeas: ['a'],
      ironyPotential: 0.2,
      energy: 0.5,
    };
    expect(NarrativeSegment.safeParse({ ...base, literalness: 0.5 }).success).toBe(true);
    expect(NarrativeSegment.safeParse({ ...base, literalness: 1.2 }).success).toBe(false);
  });
});
