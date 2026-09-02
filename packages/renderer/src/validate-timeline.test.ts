import {
  DEFAULT_DIRECTION,
  DEFAULT_TRANSFORM,
  Timeline,
  type TimelineClip,
} from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { validateTimeline } from './validate-timeline';

function clip(overrides: Partial<TimelineClip> & { id: string }): TimelineClip {
  const range = overrides.timeline ?? { startMs: 0, endMs: 1000 };
  return {
    id: overrides.id,
    momentId: overrides.momentId ?? `mom_${overrides.id}`,
    timeline: range,
    source: overrides.source ?? {
      assetId: 'ast_1',
      startMs: 0,
      endMs: range.endMs - range.startMs,
    },
    transform: overrides.transform ?? DEFAULT_TRANSFORM,
    effects: overrides.effects ?? [],
    direction: overrides.direction ?? DEFAULT_DIRECTION,
    ...(overrides.transitionOut ? { transitionOut: overrides.transitionOut } : {}),
    reason: overrides.reason ?? { segmentId: 'nar_1', semanticScore: 0.5, finalScore: 0.5 },
  };
}

function timeline(overrides: { durationMs: number; clips: TimelineClip[] }): Timeline {
  return Timeline.parse({
    projectId: 'prj_1',
    durationMs: overrides.durationMs,
    audio: { path: 'storage/audio/prj_1/original.mp3', timelineStartMs: 0, sourceStartMs: 0 },
    clips: overrides.clips,
  });
}

describe('validateTimeline', () => {
  it('flags overlapping clips as a hard error', () => {
    const tl = timeline({
      durationMs: 3000,
      clips: [
        clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } }),
        clip({ id: 'clp_2', timeline: { startMs: 500, endMs: 1500 } }),
      ],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'CLIP_OVERLAP', clipId: 'clp_2' }),
    );
  });

  it('flags a clip ending past durationMs as out of bounds', () => {
    const tl = timeline({
      durationMs: 1000,
      clips: [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1500 } })],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'CLIP_OUT_OF_BOUNDS', clipId: 'clp_1' }),
    );
  });

  it('flags startMs >= endMs as an invalid range', () => {
    const tl = timeline({
      durationMs: 1000,
      clips: [clip({ id: 'clp_1', timeline: { startMs: 500, endMs: 500 } })],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_RANGE', clipId: 'clp_1' }),
    );
  });

  it('fails when there is a gap at the start of the timeline', () => {
    const tl = gappedTimeline();
    expect(validateTimeline(tl).ok).toBe(false);
    expect(validateTimeline(tl).errors).toContainEqual(
      expect.objectContaining({ code: 'TIMELINE_GAP' }),
    );
  });

  it('warns when a clip slot is shorter than the minimum', () => {
    const tl = timeline({
      durationMs: 210,
      clips: [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 210 } })],
    });
    const result = validateTimeline(tl);
    expect(result.warnings).toContainEqual({
      code: 'CLIP_TOO_SHORT',
      clipId: 'clp_1',
      durationMs: 210,
    });
  });

  it('rejects an empty timeline as a hard error', () => {
    expect(validateTimeline(timeline({ durationMs: 3_000, clips: [] }))).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: 'EMPTY_TIMELINE' })],
    });
  });

  it('does not warn about a gap between adjacent clips', () => {
    const tl = timeline({
      durationMs: 2000,
      clips: [
        clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } }),
        clip({ id: 'clp_2', timeline: { startMs: 1000, endMs: 2000 } }),
      ],
    });
    const result = validateTimeline(tl);
    expect(result.warnings.some((w) => w.code === 'TIMELINE_GAP')).toBe(false);
  });

  it('warns about an unknown effect without failing', () => {
    const tl = timeline({
      durationMs: 1000,
      clips: [clip({ id: 'clp_1', effects: [{ type: 'zoom', startMs: 0, endMs: 1000 }] })],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_EFFECT', clipId: 'clp_1' }),
    );
  });

  it('does not warn about a well-formed zoom', () => {
    const tl = timeline({
      durationMs: 2000,
      clips: [
        clip({
          id: 'clp_1',
          timeline: { startMs: 0, endMs: 2000 },
          effects: [{ type: 'zoom', startMs: 1350, endMs: 2000, from: 1, to: 1.12 }],
        }),
      ],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'UNKNOWN_EFFECT')).toBe(false);
  });

  it('accepts well-formed hold and speed effects without a warning', () => {
    const tl = timeline({
      durationMs: 2000,
      clips: [
        clip({
          id: 'clp_1',
          timeline: { startMs: 0, endMs: 2000 },
          effects: [
            { type: 'speed', startMs: 0, endMs: 2000, factor: 1.25, requested: 'speed_up' },
            { type: 'hold', startMs: 1500, endMs: 2000, requested: 'hold' },
          ],
        }),
      ],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'UNKNOWN_EFFECT')).toBe(false);
  });

  it('warns about a hold outside its slot or a speed with a bad factor', () => {
    const badHold = validateTimeline(
      timeline({
        durationMs: 2000,
        clips: [
          clip({
            id: 'clp_1',
            timeline: { startMs: 0, endMs: 2000 },
            effects: [{ type: 'hold', startMs: 1500, endMs: 2500 }],
          }),
        ],
      }),
    );
    expect(badHold.warnings).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_EFFECT', clipId: 'clp_1' }),
    );

    const badSpeed = validateTimeline(
      timeline({
        durationMs: 2000,
        clips: [
          clip({
            id: 'clp_1',
            timeline: { startMs: 0, endMs: 2000 },
            effects: [{ type: 'speed', startMs: 0, endMs: 2000, factor: 0 }],
          }),
        ],
      }),
    );
    expect(badSpeed.warnings).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_EFFECT', clipId: 'clp_1' }),
    );
  });

  it('warns about an effect type outside the vocabulary', () => {
    const tl = timeline({
      durationMs: 1000,
      clips: [clip({ id: 'clp_1', effects: [{ type: 'glitch', startMs: 0, endMs: 200 }] })],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_EFFECT', clipId: 'clp_1' }),
    );
  });

  it('fails when the source is shorter than the timeline slot', () => {
    expect(validateTimeline(sourceShortTimeline()).errors).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_SHORTER_THAN_SLOT', clipId: 'clp_1' }),
    );
  });

  it('rejects a transition longer than a third of the smaller neighboring slot', () => {
    const result = validateTimeline(
      timeline({
        durationMs: 3000,
        clips: [
          clip({
            id: 'clp_1',
            timeline: { startMs: 0, endMs: 2000 },
            source: { assetId: 'ast_1', startMs: 1000, endMs: 3000 },
            transitionOut: { style: 'crossfade', durationMs: 400, requested: 'crossfade' },
          }),
          clip({
            id: 'clp_2',
            timeline: { startMs: 2000, endMs: 3000 },
            source: { assetId: 'ast_1', startMs: 1000, endMs: 2000 },
          }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'TRANSITION_TOO_LONG', clipId: 'clp_1' }),
    );
  });

  it('rejects an overlapping transition whose head handle would start before source time zero', () => {
    const result = validateTimeline(
      timeline({
        durationMs: 4000,
        clips: [
          clip({
            id: 'clp_1',
            timeline: { startMs: 0, endMs: 2000 },
            source: { assetId: 'ast_1', startMs: 1000, endMs: 3000 },
            transitionOut: { style: 'whip', durationMs: 200, requested: 'whip' },
          }),
          clip({
            id: 'clp_2',
            timeline: { startMs: 2000, endMs: 4000 },
            source: { assetId: 'ast_1', startMs: 50, endMs: 2050 },
          }),
        ],
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'TRANSITION_HANDLE_OUT_OF_BOUNDS', clipId: 'clp_2' }),
    );
  });

  it('accepts a dip to black without any source handle', () => {
    const result = validateTimeline(
      timeline({
        durationMs: 4000,
        clips: [
          clip({
            id: 'clp_1',
            timeline: { startMs: 0, endMs: 2000 },
            transitionOut: { style: 'dip_black', durationMs: 300, requested: 'dip_black' },
          }),
          clip({ id: 'clp_2', timeline: { startMs: 2000, endMs: 4000 } }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects incoming plus outgoing transitions that exceed a clip', () => {
    // 600 ms middle slot; 200 ms in each direction is within the third cap
    // (200 ≤ 666 from the 2000 ms neighbors... but the cap uses the smaller
    // slot: 600 / 3 = 200), and 200 + 200 ≤ 600 — so force the overlap with
    // a hand-edited 300 ms pair, which the cap alone would also reject; the
    // dedicated code must still be reported.
    const result = validateTimeline(
      timeline({
        durationMs: 4600,
        clips: [
          clip({
            id: 'clp_1',
            timeline: { startMs: 0, endMs: 2000 },
            transitionOut: { style: 'dip_black', durationMs: 400, requested: 'dip_black' },
          }),
          clip({
            id: 'clp_2',
            timeline: { startMs: 2000, endMs: 2600 },
            transitionOut: { style: 'flash', durationMs: 400, requested: 'flash' },
          }),
          clip({ id: 'clp_3', timeline: { startMs: 2600, endMs: 4600 } }),
        ],
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'OVERLAPPING_TRANSITIONS', clipId: 'clp_2' }),
    );
  });

  it('fails when timeline duration differs from the selected edit window', () => {
    const result = validateTimeline(
      timeline({
        durationMs: 1_000,
        clips: [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1_000 } })],
      }),
      { expectedDurationMs: 2_000 },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'TIMELINE_DURATION_MISMATCH' }),
    );
  });

  it('accepts a complete timeline matching the selected edit-window duration', () => {
    const result = validateTimeline(
      timeline({
        durationMs: 1_000,
        clips: [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1_000 } })],
      }),
      { expectedDurationMs: 1_000 },
    );

    expect(result.ok).toBe(true);
  });
});

function gappedTimeline(): Timeline {
  return timeline({
    durationMs: 3_000,
    clips: [clip({ id: 'clp_1', timeline: { startMs: 1_000, endMs: 3_000 } })],
  });
}

function sourceShortTimeline(): Timeline {
  return timeline({
    durationMs: 2_000,
    clips: [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2_000 },
        source: { assetId: 'ast_1', startMs: 0, endMs: 500 },
      }),
    ],
  });
}
