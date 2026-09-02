import type { Timeline, TimelineClip, TimelineDirection, TimelineRange } from '@memetize/timeline';
import {
  DEFAULT_DIRECTION,
  DEFAULT_TRANSFORM,
  Timeline as TimelineSchema,
} from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { resolveCutStyles } from './cut-styles';
import type { CutSourceBounds } from './types';

const BEAT_MS = 500; // 120 bpm

interface ClipSpec {
  id: string;
  timeline: TimelineRange;
  /** Absolute source range; defaults to `[0, slot]`. */
  source?: { startMs: number; endMs: number };
  /** Moment bounds; defaults to exactly the source range (no handles). */
  bounds?: CutSourceBounds;
  direction?: Partial<TimelineDirection>;
}

function clip(spec: ClipSpec): TimelineClip {
  const slotMs = spec.timeline.endMs - spec.timeline.startMs;
  const source = spec.source ?? { startMs: 0, endMs: slotMs };
  return {
    id: spec.id,
    momentId: `mom_${spec.id}`,
    timeline: spec.timeline,
    source: { assetId: `ast_${spec.id}`, ...source },
    transform: DEFAULT_TRANSFORM,
    effects: [],
    direction: { ...DEFAULT_DIRECTION, ...spec.direction },
    reason: { segmentId: `seg_${spec.id}`, semanticScore: 0.5, finalScore: 0.5 },
  };
}

function build(specs: ClipSpec[]) {
  const clips = specs.map(clip);
  const durationMs = Math.max(...clips.map((entry) => entry.timeline.endMs));
  const timeline: Timeline = {
    schemaVersion: '1.0',
    projectId: 'prj_test',
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationMs,
    audio: { path: 'a.mp3', timelineStartMs: 0, sourceStartMs: 0, volume: 1 },
    clips,
  };
  const sourceBoundsByMomentId = new Map<string, CutSourceBounds>(
    specs.map((spec, index) => {
      const source = clips[index]?.source;
      const bounds = spec.bounds ?? { startMs: source?.startMs ?? 0, endMs: source?.endMs ?? 0 };
      return [`mom_${spec.id}`, bounds];
    }),
  );
  return { timeline, context: { beatMs: BEAT_MS, sourceBoundsByMomentId } };
}

/** Two 2,000 ms clips, both with 1,000 ms of spare source on each side. */
function pair(
  transitionOut: TimelineDirection['transitionOut'],
  overrides: Partial<ClipSpec>[] = [],
) {
  return build([
    {
      id: 'a',
      timeline: { startMs: 0, endMs: 2000 },
      source: { startMs: 1000, endMs: 3000 },
      bounds: { startMs: 0, endMs: 4000 },
      direction: { transitionOut },
      ...overrides[0],
    },
    {
      id: 'b',
      timeline: { startMs: 2000, endMs: 4000 },
      source: { startMs: 1000, endMs: 3000 },
      bounds: { startMs: 0, endMs: 4000 },
      ...overrides[1],
    },
  ]);
}

describe('resolveCutStyles: transitions', () => {
  it('keeps a crossfade at one beat when both sides have handles', () => {
    const { timeline, context } = pair('crossfade');
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.transitionOut).toEqual({
      style: 'crossfade',
      durationMs: 500,
      requested: 'crossfade',
    });
    expect(result.cuts).toEqual([
      {
        clipId: 'a',
        kind: 'transition',
        requested: 'crossfade',
        resolved: 'crossfade',
        durationMs: 500,
      },
    ]);
  });

  it('shrinks a crossfade to the minimum when only a small handle exists', () => {
    // B has 120 ms of head handle: 250 (for 500 ms) fails, 100 (for 200 ms) fits.
    const { timeline, context } = pair('crossfade', [
      {},
      { source: { startMs: 120, endMs: 2120 }, bounds: { startMs: 0, endMs: 4000 } },
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.transitionOut).toEqual({
      style: 'crossfade',
      durationMs: 200,
      requested: 'crossfade',
    });
  });

  it('downgrades a crossfade to dip_black when the next clip has no head handle', () => {
    const { timeline, context } = pair('crossfade', [
      {},
      { source: { startMs: 0, endMs: 2000 }, bounds: { startMs: 0, endMs: 4000 } },
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.transitionOut).toEqual({
      style: 'dip_black',
      durationMs: 250,
      requested: 'crossfade',
      downgradeReason: 'no_source_handle',
    });
    expect(result.cuts[0]).toMatchObject({ resolved: 'dip_black', reason: 'no_source_handle' });
  });

  it('downgrades a crossfade to a shrunk dip_black when the slot is too short', () => {
    // 500 ms slots: a third is 166 ms, under the crossfade minimum (200) but
    // above the dip_black minimum (150).
    const { timeline, context } = build([
      {
        id: 'a',
        timeline: { startMs: 0, endMs: 500 },
        source: { startMs: 1000, endMs: 1500 },
        bounds: { startMs: 0, endMs: 4000 },
        direction: { transitionOut: 'crossfade' },
      },
      {
        id: 'b',
        timeline: { startMs: 500, endMs: 1000 },
        source: { startMs: 1000, endMs: 1500 },
        bounds: { startMs: 0, endMs: 4000 },
      },
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.transitionOut).toEqual({
      style: 'dip_black',
      durationMs: 150,
      requested: 'crossfade',
      downgradeReason: 'slot_too_short',
    });
  });

  it('downgrades a whip to hard when there are no handles', () => {
    const { timeline, context } = pair('whip', [
      { source: { startMs: 0, endMs: 2000 }, bounds: { startMs: 0, endMs: 2000 } },
      {},
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.transitionOut).toEqual({
      style: 'hard',
      durationMs: 0,
      requested: 'whip',
      downgradeReason: 'no_source_handle',
    });
  });

  it('keeps a whip at half a beat with handles', () => {
    const { timeline, context } = pair('whip');
    expect(resolveCutStyles(timeline, context).timeline.clips[0]?.transitionOut).toEqual({
      style: 'whip',
      durationMs: 250,
      requested: 'whip',
    });
  });

  it('keeps dip_black and flash without any handles', () => {
    const dip = pair('dip_black', [
      { source: { startMs: 0, endMs: 2000 }, bounds: { startMs: 0, endMs: 2000 } },
      { source: { startMs: 0, endMs: 2000 }, bounds: { startMs: 0, endMs: 2000 } },
    ]);
    expect(resolveCutStyles(dip.timeline, dip.context).timeline.clips[0]?.transitionOut).toEqual({
      style: 'dip_black',
      durationMs: 250,
      requested: 'dip_black',
    });

    const flash = pair('flash', [
      { source: { startMs: 0, endMs: 2000 }, bounds: { startMs: 0, endMs: 2000 } },
      { source: { startMs: 0, endMs: 2000 }, bounds: { startMs: 0, endMs: 2000 } },
    ]);
    expect(
      resolveCutStyles(flash.timeline, flash.context).timeline.clips[0]?.transitionOut,
    ).toEqual({ style: 'flash', durationMs: 124, requested: 'flash' });
  });

  it('shrinks a flash on a short slot and drops it to hard on a very short one', () => {
    const short = build([
      { id: 'a', timeline: { startMs: 0, endMs: 300 }, direction: { transitionOut: 'flash' } },
      { id: 'b', timeline: { startMs: 300, endMs: 2300 } },
    ]);
    expect(
      resolveCutStyles(short.timeline, short.context).timeline.clips[0]?.transitionOut,
    ).toEqual({ style: 'flash', durationMs: 80, requested: 'flash' });

    const tiny = build([
      { id: 'a', timeline: { startMs: 0, endMs: 200 }, direction: { transitionOut: 'flash' } },
      { id: 'b', timeline: { startMs: 200, endMs: 2200 } },
    ]);
    expect(resolveCutStyles(tiny.timeline, tiny.context).timeline.clips[0]?.transitionOut).toEqual({
      style: 'hard',
      durationMs: 0,
      requested: 'flash',
      downgradeReason: 'slot_too_short',
    });
  });

  it('always cuts the last clip hard', () => {
    const { timeline, context } = pair('hard', [{}, { direction: { transitionOut: 'crossfade' } }]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[1]?.transitionOut).toEqual({
      style: 'hard',
      durationMs: 0,
      requested: 'crossfade',
      downgradeReason: 'last_clip',
    });
  });

  it('records a hard request as hard with no decision', () => {
    const { timeline, context } = pair('hard');
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.transitionOut).toEqual({
      style: 'hard',
      durationMs: 0,
      requested: 'hard',
    });
    expect(result.cuts).toEqual([]);
  });

  it('treats a missing bounds entry as having no handles', () => {
    const { timeline } = pair('crossfade');
    const result = resolveCutStyles(timeline, {
      beatMs: BEAT_MS,
      sourceBoundsByMomentId: new Map(),
    });
    expect(result.timeline.clips[0]?.transitionOut?.style).toBe('dip_black');
  });
});

describe('resolveCutStyles: clip styles', () => {
  it('holds one beat on the tail of a long clip', () => {
    const { timeline, context } = build([
      { id: 'a', timeline: { startMs: 0, endMs: 2000 }, direction: { clipStyle: 'hold' } },
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.effects).toEqual([
      { type: 'hold', startMs: 1500, endMs: 2000, requested: 'hold' },
    ]);
    expect(result.cuts).toEqual([
      { clipId: 'a', kind: 'clip', requested: 'hold', resolved: 'hold', durationMs: 500 },
    ]);
  });

  it('shrinks a hold so at least 300 ms of motion remain, or drops it', () => {
    const shrunk = build([
      { id: 'a', timeline: { startMs: 0, endMs: 600 }, direction: { clipStyle: 'hold' } },
    ]);
    expect(resolveCutStyles(shrunk.timeline, shrunk.context).timeline.clips[0]?.effects).toEqual([
      { type: 'hold', startMs: 400, endMs: 600, requested: 'hold' },
    ]);

    const dropped = build([
      { id: 'a', timeline: { startMs: 0, endMs: 400 }, direction: { clipStyle: 'hold' } },
    ]);
    const result = resolveCutStyles(dropped.timeline, dropped.context);
    expect(result.timeline.clips[0]?.effects).toEqual([]);
    expect(result.cuts).toEqual([
      {
        clipId: 'a',
        kind: 'clip',
        requested: 'hold',
        resolved: 'none',
        durationMs: 0,
        reason: 'slot_too_short',
      },
    ]);
  });

  it('speeds up a clip by extending its source when the moment has spare tail', () => {
    const { timeline, context } = build([
      {
        id: 'a',
        timeline: { startMs: 0, endMs: 2000 },
        source: { startMs: 0, endMs: 2000 },
        bounds: { startMs: 0, endMs: 2500 },
        direction: { clipStyle: 'speed_up' },
      },
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.source).toEqual({ assetId: 'ast_a', startMs: 0, endMs: 2500 });
    expect(result.timeline.clips[0]?.effects).toEqual([
      { type: 'speed', startMs: 0, endMs: 2000, factor: 1.25, requested: 'speed_up' },
    ]);
  });

  it('drops a speed-up when the moment has no spare tail', () => {
    const { timeline, context } = build([
      {
        id: 'a',
        timeline: { startMs: 0, endMs: 2000 },
        source: { startMs: 0, endMs: 2000 },
        bounds: { startMs: 0, endMs: 2400 },
        direction: { clipStyle: 'speed_up' },
      },
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.source.endMs).toBe(2000);
    expect(result.timeline.clips[0]?.effects).toEqual([]);
    expect(result.cuts[0]).toMatchObject({ resolved: 'none', reason: 'no_source_handle' });
  });

  it('always slows down', () => {
    const { timeline, context } = build([
      { id: 'a', timeline: { startMs: 0, endMs: 2000 }, direction: { clipStyle: 'slow_down' } },
    ]);
    expect(resolveCutStyles(timeline, context).timeline.clips[0]?.effects).toEqual([
      { type: 'speed', startMs: 0, endMs: 2000, factor: 0.8, requested: 'slow_down' },
    ]);
  });
});

describe('resolveCutStyles: interactions', () => {
  it('lets a held clip crossfade out without a tail handle (the freeze supplies it)', () => {
    const { timeline, context } = pair('crossfade', [
      {
        source: { startMs: 0, endMs: 2000 },
        bounds: { startMs: 0, endMs: 2000 },
        direction: { clipStyle: 'hold', transitionOut: 'crossfade' },
      },
      {},
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.transitionOut?.style).toBe('crossfade');
  });

  it('scales the handle a sped-up clip needs by its factor', () => {
    // A: slot 2000, speed_up extends source to 2500; a 500 ms crossfade
    // needs 250 output ms of tail = 313 source ms beyond 2500. Bounds end at
    // 2800, so 500 fails and the 200 ms minimum (125 source ms) fits.
    const { timeline, context } = pair('crossfade', [
      {
        source: { startMs: 0, endMs: 2000 },
        bounds: { startMs: 0, endMs: 2800 },
        direction: { clipStyle: 'speed_up', transitionOut: 'crossfade' },
      },
      {},
    ]);
    const result = resolveCutStyles(timeline, context);
    expect(result.timeline.clips[0]?.source.endMs).toBe(2500);
    expect(result.timeline.clips[0]?.transitionOut).toEqual({
      style: 'crossfade',
      durationMs: 200,
      requested: 'crossfade',
    });
  });

  it('never moves slots, is deterministic, and produces a parseable timeline', () => {
    const { timeline, context } = pair('whip', [
      { direction: { clipStyle: 'hold', transitionOut: 'whip' } },
      { direction: { clipStyle: 'slow_down' } },
    ]);
    const first = resolveCutStyles(timeline, context);
    const second = resolveCutStyles(timeline, context);
    expect(first).toEqual(second);
    expect(first.timeline.clips.map((entry) => entry.timeline)).toEqual(
      timeline.clips.map((entry) => entry.timeline),
    );
    expect(TimelineSchema.parse(first.timeline)).toEqual(first.timeline);
  });

  it('falls back to a 500 ms beat when the context has none', () => {
    const { timeline, context } = pair('crossfade');
    const result = resolveCutStyles(timeline, {
      sourceBoundsByMomentId: context.sourceBoundsByMomentId,
    });
    expect(result.timeline.clips[0]?.transitionOut?.durationMs).toBe(500);
  });
});
