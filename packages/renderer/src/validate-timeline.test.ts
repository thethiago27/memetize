import { DEFAULT_TRANSFORM, Timeline, type TimelineClip } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { validateTimeline } from './validate-timeline';

function clip(overrides: Partial<TimelineClip> & { id: string }): TimelineClip {
  return {
    id: overrides.id,
    momentId: overrides.momentId ?? `mom_${overrides.id}`,
    timeline: overrides.timeline ?? { startMs: 0, endMs: 1000 },
    source: overrides.source ?? { assetId: 'ast_1', startMs: 0, endMs: 1000 },
    transform: overrides.transform ?? DEFAULT_TRANSFORM,
    effects: overrides.effects ?? [],
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

  it('warns about a gap at the start of the timeline', () => {
    const tl = timeline({
      durationMs: 3000,
      clips: [clip({ id: 'clp_1', timeline: { startMs: 1000, endMs: 3000 } })],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({ code: 'TIMELINE_GAP', startMs: 0, endMs: 1000 });
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

  it('marks an empty timeline as valid with an EMPTY_TIMELINE warning and no gap warning', () => {
    const tl = timeline({ durationMs: 3000, clips: [] });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([{ code: 'EMPTY_TIMELINE' }]);
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

  it('warns about an unsupported effect type such as fade', () => {
    const tl = timeline({
      durationMs: 1000,
      clips: [clip({ id: 'clp_1', effects: [{ type: 'fade', startMs: 0, endMs: 200 }] })],
    });
    const result = validateTimeline(tl);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_EFFECT', clipId: 'clp_1' }),
    );
  });

  it('warns when the source is shorter than the timeline slot', () => {
    const tl = timeline({
      durationMs: 2000,
      clips: [
        clip({
          id: 'clp_1',
          timeline: { startMs: 0, endMs: 2000 },
          source: { assetId: 'ast_1', startMs: 0, endMs: 500 },
        }),
      ],
    });
    const result = validateTimeline(tl);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOURCE_SHORTER_THAN_SLOT',
        clipId: 'clp_1',
        durationMs: 500,
      }),
    );
  });
});
