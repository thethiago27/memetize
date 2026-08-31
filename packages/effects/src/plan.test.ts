import type { Timeline, TimelineClip, TimelineRange } from '@memetize/timeline';
import { Timeline as TimelineSchema } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { MIN_ZOOM_MS, ZOOM_FROM, ZOOM_TAIL_MS, ZOOM_TO, ZOOM_TO_HIGH } from './constants';
import { planEffects } from './plan';
import type { EffectsContext } from './types';

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
  entries: ReadonlyArray<[string, { narrativeFunction: string; energy: number }]>,
): EffectsContext {
  return { segmentById: new Map(entries) };
}

describe('planEffects', () => {
  it('adds a tail zoom on a payoff clip with from=1 and to=1.12', () => {
    const clip = buildClip('clp_1', { startMs: 1000, endMs: 3000 });
    const timeline = buildTimeline([clip]);

    const result = planEffects(
      timeline,
      context([['seg_clp_1', { narrativeFunction: 'payoff', energy: 0.4 }]]),
    );

    expect(result.planned).toEqual([
      {
        clipId: 'clp_1',
        type: 'zoom',
        startMs: 3000 - ZOOM_TAIL_MS,
        endMs: 3000,
        from: ZOOM_FROM,
        to: ZOOM_TO,
      },
    ]);
    expect(result.timeline.clips[0]?.effects).toEqual([
      { type: 'zoom', startMs: 2350, endMs: 3000, from: 1, to: 1.12 },
    ]);
  });

  it('uses a stronger zoom when segment energy is at least 0.7', () => {
    const clip = buildClip('clp_1', { startMs: 0, endMs: 2000 });
    const timeline = buildTimeline([clip]);

    const result = planEffects(
      timeline,
      context([['seg_clp_1', { narrativeFunction: 'Punchline', energy: 0.7 }]]),
    );

    expect(result.planned[0]?.to).toBe(ZOOM_TO_HIGH);
    expect(result.timeline.clips[0]?.effects[0]).toMatchObject({ to: 1.18 });
  });

  it('leaves setup and unknown narrative functions without effects', () => {
    const setup = buildClip('clp_setup', { startMs: 0, endMs: 1000 });
    const unknown = buildClip('clp_unknown', { startMs: 1000, endMs: 2000 });
    const timeline = buildTimeline([setup, unknown]);

    const result = planEffects(
      timeline,
      context([
        ['seg_clp_setup', { narrativeFunction: 'setup', energy: 0.9 }],
        ['seg_clp_unknown', { narrativeFunction: 'verse', energy: 0.9 }],
      ]),
    );

    expect(result.timeline.clips[0]?.effects).toEqual([]);
    expect(result.timeline.clips[1]?.effects).toEqual([]);
    expect(result.planned).toEqual([]);
  });

  it('lets a short clip zoom across its entire slot', () => {
    const clip = buildClip('clp_1', { startMs: 100, endMs: 300 });
    const timeline = buildTimeline([clip]);

    const result = planEffects(
      timeline,
      context([['seg_clp_1', { narrativeFunction: 'climax', energy: 0.2 }]]),
    );

    expect(result.planned[0]).toMatchObject({
      startMs: 100,
      endMs: 300,
      from: ZOOM_FROM,
      to: ZOOM_TO,
    });
    expect(clip.timeline.endMs - clip.timeline.startMs).toBeLessThan(MIN_ZOOM_MS);
  });

  it('returns the timeline unchanged with no planned effects when there are no clips', () => {
    const timeline = buildTimeline([]);

    const result = planEffects(timeline, context([]));

    expect(result.timeline.clips).toEqual([]);
    expect(result.planned).toEqual([]);
  });

  it('clears leftover effects on a non-punchline clip', () => {
    const clip = buildClip(
      'clp_1',
      { startMs: 0, endMs: 2000 },
      {
        effects: [{ type: 'zoom', startMs: 1500, endMs: 2000, from: 1, to: 1.12 }],
      },
    );
    const timeline = buildTimeline([clip]);

    const result = planEffects(
      timeline,
      context([['seg_clp_1', { narrativeFunction: 'setup', energy: 0.9 }]]),
    );

    expect(result.timeline.clips[0]?.effects).toEqual([]);
    expect(result.planned).toEqual([]);
  });

  it('replaces pre-existing effects instead of appending', () => {
    const clip = buildClip(
      'clp_1',
      { startMs: 0, endMs: 2000 },
      {
        effects: [{ type: 'fade', startMs: 0, endMs: 200 }],
      },
    );
    const timeline = buildTimeline([clip]);

    const result = planEffects(
      timeline,
      context([['seg_clp_1', { narrativeFunction: 'payoff', energy: 0.3 }]]),
    );

    expect(result.timeline.clips[0]?.effects).toHaveLength(1);
    expect(result.timeline.clips[0]?.effects[0]?.type).toBe('zoom');
  });

  it('leaves timeline, source, transform and reason identical to the input', () => {
    const source = { assetId: 'ast_9', startMs: 300, endMs: 2300 };
    const transform = { scale: 1.2, positionX: 0.4, positionY: 0.6, cropMode: 'contain' as const };
    const reason = { segmentId: 'seg_clp_1', semanticScore: 0.8, finalScore: 0.7 };
    const clip = buildClip('clp_1', { startMs: 1000, endMs: 3000 }, { source, transform, reason });
    const timeline = buildTimeline([clip]);

    const result = planEffects(
      timeline,
      context([['seg_clp_1', { narrativeFunction: 'payoff', energy: 0.3 }]]),
    );

    const plannedClip = result.timeline.clips[0];
    expect(plannedClip?.timeline).toEqual({ startMs: 1000, endMs: 3000 });
    expect(plannedClip?.source).toEqual(source);
    expect(plannedClip?.transform).toEqual(transform);
    expect(plannedClip?.reason).toEqual(reason);
    expect(result.timeline.durationMs).toBe(timeline.durationMs);
    expect(result.timeline.audio).toEqual(timeline.audio);
    expect(result.timeline.canvas).toEqual(timeline.canvas);
  });

  it('produces a Timeline.parse-able document with absolute effect times inside the slot', () => {
    const clip = buildClip('clp_1', { startMs: 1200, endMs: 3200 });
    const timeline = buildTimeline([clip]);

    const result = planEffects(
      timeline,
      context([['seg_clp_1', { narrativeFunction: 'payoff', energy: 0.3 }]]),
    );

    expect(() => TimelineSchema.parse(result.timeline)).not.toThrow();
    const effect = result.timeline.clips[0]?.effects[0];
    expect(effect?.startMs).toBeGreaterThanOrEqual(1200);
    expect(effect?.endMs).toBeLessThanOrEqual(3200);
    expect(effect?.startMs).toBeLessThan(effect?.endMs ?? 0);
  });
});
