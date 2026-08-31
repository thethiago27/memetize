import type { Timeline, TimelineClip, TimelineRange } from '@memetize/timeline';
import { Timeline as TimelineSchema } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { optimizeTiming } from './optimize';
import type { TimingBeat, TimingContext } from './types';

function buildClip(
  id: string,
  timeline: TimelineRange,
  overrides: Partial<TimelineClip> = {},
): TimelineClip {
  const slotMs = timeline.endMs - timeline.startMs;
  return {
    id,
    momentId: `mom_${id}`,
    timeline,
    source: overrides.source ?? { assetId: 'ast_1', startMs: 0, endMs: slotMs },
    transform: overrides.transform ?? {
      scale: 1,
      positionX: 0.5,
      positionY: 0.5,
      cropMode: 'cover',
    },
    effects: overrides.effects ?? [],
    reason: overrides.reason ?? { segmentId: `seg_${id}`, semanticScore: 0.5, finalScore: 0.5 },
  };
}

function buildTimeline(clips: TimelineClip[], durationMs = 10_000): Timeline {
  return {
    schemaVersion: '1.0',
    projectId: 'prj_test',
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationMs,
    audio: { path: 'a.mp3', timelineStartMs: 0, sourceStartMs: 0, volume: 1 },
    clips,
  };
}

function context(
  beats: TimingBeat[],
  segmentFunctionById: ReadonlyMap<string, string> = new Map(),
): TimingContext {
  return { beats, segmentFunctionById };
}

describe('optimizeTiming', () => {
  it('snaps a clip start to the nearest beat within the snap window', () => {
    const clip = buildClip('clp_1', { startMs: 1040, endMs: 2040 });
    const timeline = buildTimeline([clip]);
    const beats: TimingBeat[] = [{ timeMs: 1000, strength: 0.5, isDownbeat: false }];

    const result = optimizeTiming(timeline, context(beats));

    expect(result.timeline.clips[0]?.timeline).toEqual({ startMs: 1000, endMs: 2000 });
    expect(result.adjustments).toEqual([
      {
        clipId: 'clp_1',
        originalStartMs: 1040,
        adjustedStartMs: 1000,
        deltaMs: -40,
        snappedTo: 'beat',
      },
    ]);
  });

  it('does not move a clip when no beat is within the snap window', () => {
    const clip = buildClip('clp_1', { startMs: 1000, endMs: 2000 });
    const timeline = buildTimeline([clip]);
    const beats: TimingBeat[] = [{ timeMs: 1500, strength: 0.5, isDownbeat: false }];

    const result = optimizeTiming(timeline, context(beats));

    expect(result.timeline.clips[0]?.timeline).toEqual({ startMs: 1000, endMs: 2000 });
    expect(result.adjustments[0]).toMatchObject({ snappedTo: 'none', deltaMs: 0 });
  });

  it('gives a punchline segment a wider window and prefers a downbeat over a closer plain beat', () => {
    const clip = buildClip('clp_1', { startMs: 1000, endMs: 2000 });
    const timeline = buildTimeline([clip]);
    const beats: TimingBeat[] = [
      { timeMs: 1050, strength: 0.9, isDownbeat: false },
      { timeMs: 1200, strength: 0.5, isDownbeat: true },
    ];
    const segmentFunctionById = new Map([['seg_clp_1', 'payoff']]);

    const result = optimizeTiming(timeline, context(beats, segmentFunctionById));

    expect(result.adjustments[0]).toMatchObject({ adjustedStartMs: 1200, snappedTo: 'downbeat' });
  });

  it('does not reach past the snap window just because a segment is a punchline', () => {
    const clip = buildClip('clp_1', { startMs: 1000, endMs: 2000 });
    const timeline = buildTimeline([clip]);
    const beats: TimingBeat[] = [{ timeMs: 1300, strength: 0.5, isDownbeat: true }];
    const segmentFunctionById = new Map([['seg_clp_1', 'setup']]);

    const result = optimizeTiming(timeline, context(beats, segmentFunctionById));

    expect(result.adjustments[0]).toMatchObject({ snappedTo: 'none' });
  });

  it('prefers the beat with higher onset strength when two beats are equally close', () => {
    const clip = buildClip('clp_1', { startMs: 1000, endMs: 2000 });
    const timeline = buildTimeline([clip]);
    const beats: TimingBeat[] = [
      { timeMs: 1050, strength: 0.3, isDownbeat: false },
      { timeMs: 950, strength: 0.9, isDownbeat: false },
    ];

    const result = optimizeTiming(timeline, context(beats));

    expect(result.adjustments[0]).toMatchObject({ adjustedStartMs: 950, snappedTo: 'beat' });
  });

  it('never lets two adjacent clips overlap even when both are pulled toward the same downbeat', () => {
    const clipA = buildClip('clp_a', { startMs: 1900, endMs: 2000 });
    const clipB = buildClip('clp_b', { startMs: 2000, endMs: 2100 });
    const timeline = buildTimeline([clipA, clipB], 3000);
    const beats: TimingBeat[] = [{ timeMs: 2000, strength: 1, isDownbeat: true }];

    const result = optimizeTiming(timeline, context(beats));

    const ranges = result.timeline.clips.map((clip) => clip.timeline);
    expect(ranges).toHaveLength(2);
    const [rangeA, rangeB] = ranges as [TimelineRange, TimelineRange];
    expect(rangeA.endMs).toBeLessThanOrEqual(rangeB.startMs);
    // Slot durations (100ms each) are preserved even though positions shifted.
    expect(rangeA.endMs - rangeA.startMs).toBe(100);
    expect(rangeB.endMs - rangeB.startMs).toBe(100);
  });

  it('preserves slot duration and leaves source/transform/effects/reason untouched', () => {
    const source = { assetId: 'ast_9', startMs: 300, endMs: 1300 };
    const transform = { scale: 1.2, positionX: 0.4, positionY: 0.6, cropMode: 'contain' as const };
    const reason = { segmentId: 'seg_clp_1', semanticScore: 0.8, finalScore: 0.7 };
    const clip = buildClip('clp_1', { startMs: 1030, endMs: 2030 }, { source, transform, reason });
    const timeline = buildTimeline([clip]);
    const beats: TimingBeat[] = [{ timeMs: 1000, strength: 0.5, isDownbeat: false }];

    const result = optimizeTiming(timeline, context(beats));

    const adjustedClip = result.timeline.clips[0];
    expect(adjustedClip?.timeline).toEqual({ startMs: 1000, endMs: 2000 });
    expect(adjustedClip?.source).toEqual(source);
    expect(adjustedClip?.transform).toEqual(transform);
    expect(adjustedClip?.effects).toEqual([]);
    expect(adjustedClip?.reason).toEqual(reason);
  });

  it('returns the timeline unchanged with no adjustments when there are no clips', () => {
    const timeline = buildTimeline([]);

    const result = optimizeTiming(timeline, context([]));

    expect(result.timeline.clips).toEqual([]);
    expect(result.adjustments).toEqual([]);
  });

  it('always produces a timeline that still satisfies the Timeline schema', () => {
    const clip = buildClip('clp_1', { startMs: 1040, endMs: 2040 });
    const timeline = buildTimeline([clip]);
    const beats: TimingBeat[] = [{ timeMs: 1000, strength: 0.5, isDownbeat: false }];

    const result = optimizeTiming(timeline, context(beats));

    expect(() => TimelineSchema.parse(result.timeline)).not.toThrow();
  });
});
