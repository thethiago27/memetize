import { describe, expect, it } from 'vitest';
import { selectEditWindow } from './highlight';

describe('selectEditWindow', () => {
  it('uses a 45-second source in full', () => {
    expect(
      selectEditWindow({
        trackDurationMs: 45_000,
        sections: [],
        beats: [],
        downbeats: [],
        energyCurve: [],
        lyrics: [],
      }),
    ).toMatchObject({ sourceStartMs: 0, sourceEndMs: 45_000, durationMs: 45_000 });
  });

  it('treats exactly 60 seconds as an uncropped full source', () => {
    const selected = selectEditWindow({
      trackDurationMs: 60_000,
      sections: [],
      beats: [],
      downbeats: [],
      energyCurve: [],
      lyrics: [],
    });
    expect(selected).toMatchObject({
      sourceStartMs: 0,
      sourceEndMs: 60_000,
      durationMs: 60_000,
    });
  });

  it('selects the energetic chorus window from a 120-second source', () => {
    const selected = selectEditWindow({
      trackDurationMs: 120_000,
      sections: [
        { type: 'intro', startMs: 0, endMs: 60_000 },
        { type: 'chorus', startMs: 60_000, endMs: 120_000 },
      ],
      beats: [
        { timeMs: 0, strength: 0.2 },
        { timeMs: 60_000, strength: 1 },
      ],
      downbeats: [0, 60_000],
      energyCurve: [
        { timeMs: 0, value: 0.1 },
        { timeMs: 60_000, value: 0.9 },
      ],
      lyrics: [{ startMs: 61_000, endMs: 90_000, text: 'hook and payoff', words: [] }],
    });
    expect(selected.sourceStartMs).toBe(60_000);
    expect(selected.sourceEndMs).toBe(120_000);
  });

  it('falls back deterministically when optional analysis is empty', () => {
    const input = {
      trackDurationMs: 90_000,
      sections: [],
      beats: [],
      downbeats: [],
      energyCurve: [],
      lyrics: [],
    };
    expect(selectEditWindow(input)).toEqual(selectEditWindow(input));
    expect(selectEditWindow(input).sourceStartMs).toBe(0);
  });
});
