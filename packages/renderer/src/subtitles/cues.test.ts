import { DEFAULT_CANVAS, Timeline } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { cuesFromLyrics } from './cues';

function timeline(overrides: {
  durationMs?: number;
  sourceStartMs?: number;
  timelineStartMs?: number;
}): Timeline {
  return Timeline.parse({
    projectId: 'prj_1',
    durationMs: overrides.durationMs ?? 10_000,
    canvas: DEFAULT_CANVAS,
    audio: {
      path: 'a.mp3',
      timelineStartMs: overrides.timelineStartMs ?? 0,
      sourceStartMs: overrides.sourceStartMs ?? 0,
    },
    clips: [
      {
        id: 'clp_1',
        momentId: 'mom_1',
        timeline: { startMs: 0, endMs: overrides.durationMs ?? 10_000 },
        source: { assetId: 'ast_1', startMs: 0, endMs: overrides.durationMs ?? 10_000 },
        reason: { segmentId: 'nar_1', semanticScore: 0.5, finalScore: 0.5 },
      },
    ],
  });
}

describe('cuesFromLyrics', () => {
  it('rebases song time onto the timeline clock with a window offset', () => {
    const cues = cuesFromLyrics(
      [{ startMs: 12_000, endMs: 14_000, text: 'hook' }],
      timeline({ durationMs: 5000, sourceStartMs: 10_000 }),
    );
    expect(cues).toEqual([{ startMs: 2000, endMs: 4000, text: 'hook' }]);
  });

  it('clamps a line that straddles the window and drops lines wholly outside', () => {
    const cues = cuesFromLyrics(
      [
        { startMs: 0, endMs: 500, text: 'before' },
        { startMs: 800, endMs: 2200, text: 'overlap' },
        { startMs: 8000, endMs: 9000, text: 'after' },
      ],
      timeline({ durationMs: 2000, sourceStartMs: 1000 }),
    );
    expect(cues).toEqual([{ startMs: 0, endMs: 1200, text: 'overlap' }]);
  });

  it('drops empty text and cues shorter than one frame', () => {
    const cues = cuesFromLyrics(
      [
        { startMs: 0, endMs: 1000, text: '   ' },
        { startMs: 1000, endMs: 1010, text: 'blink' },
        { startMs: 2000, endMs: 3000, text: 'keep' },
      ],
      timeline({ durationMs: 4000 }),
    );
    expect(cues).toEqual([{ startMs: 2000, endMs: 3000, text: 'keep' }]);
  });

  it('trims an earlier cue when consecutive lines overlap', () => {
    const cues = cuesFromLyrics(
      [
        { startMs: 0, endMs: 1500, text: 'one' },
        { startMs: 1000, endMs: 2000, text: 'two' },
      ],
      timeline({ durationMs: 3000 }),
    );
    expect(cues).toEqual([
      { startMs: 0, endMs: 1000, text: 'one' },
      { startMs: 1000, endMs: 2000, text: 'two' },
    ]);
  });
});
