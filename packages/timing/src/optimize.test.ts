import type { Timeline, TimelineClip, TimelineRange } from '@memetize/timeline';
import { Timeline as TimelineSchema } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { optimizeTiming } from './optimize';
import type { TimingContext } from './types';

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

function context(overrides: Partial<TimingContext> = {}): TimingContext {
  return {
    beats: [],
    segmentFunctionById: new Map(),
    sourceBoundsByMomentId: new Map([
      ['mom_clp_a', { startMs: 0, endMs: 4_000 }],
      ['mom_clp_b', { startMs: 0, endMs: 4_000 }],
    ]),
    ...overrides,
  };
}

function sourceBoundFixture(): Timeline {
  return buildTimeline(
    [
      buildClip('clp_a', { startMs: 0, endMs: 1_000 }, {
        source: { assetId: 'ast_a', startMs: 0, endMs: 1_000 },
      }),
      buildClip('clp_b', { startMs: 1_000, endMs: 2_000 }, {
        source: { assetId: 'ast_b', startMs: 0, endMs: 1_000 },
      }),
    ],
    2_000,
  );
}

describe('optimizeTiming', () => {
  it('snaps one shared cut without creating a gap', () => {
    const result = optimizeTiming(
      buildTimeline(
        [
          buildClip('clp_a', { startMs: 0, endMs: 1_040 }),
          buildClip('clp_b', { startMs: 1_040, endMs: 2_000 }),
        ],
        2_000,
      ),
      context({ beats: [{ timeMs: 1_000, strength: 1, isDownbeat: true }] }),
    );
    const firstClip = result.timeline.clips[0];
    const secondClip = result.timeline.clips[1];
    expect(firstClip?.timeline.endMs).toBe(1_000);
    expect(secondClip?.timeline.startMs).toBe(1_000);
    expect(firstClip ? firstClip.source.endMs - firstClip.source.startMs : 0).toBe(1_000);
  });

  it('does not lengthen a source past its moment bound', () => {
    const result = optimizeTiming(
      sourceBoundFixture(),
      context({
        beats: [{ timeMs: 1_200, strength: 1, isDownbeat: true }],
        segmentFunctionById: new Map([['seg_clp_a', 'payoff']]),
        sourceBoundsByMomentId: new Map([
          ['mom_clp_a', { startMs: 0, endMs: 1_000 }],
          ['mom_clp_b', { startMs: 0, endMs: 1_000 }],
        ]),
      }),
    );
    expect(result.adjustments[0]?.snappedTo).toBe('none');
  });

  it('keeps the first and last timeline boundaries fixed', () => {
    const result = optimizeTiming(
      buildTimeline(
        [
          buildClip('clp_a', { startMs: 0, endMs: 1_040 }),
          buildClip('clp_b', { startMs: 1_040, endMs: 2_000 }),
        ],
        2_000,
      ),
      context({ beats: [{ timeMs: 1_000, strength: 1, isDownbeat: true }] }),
    );
    expect(result.timeline.clips[0]?.timeline.startMs).toBe(0);
    expect(result.timeline.clips.at(-1)?.timeline.endMs).toBe(2_000);
    expect(result.timeline.durationMs).toBe(2_000);
  });

  it('returns the timeline unchanged with no adjustments when there are no clips', () => {
    const result = optimizeTiming(buildTimeline([]), context());
    expect(result.timeline.clips).toEqual([]);
    expect(result.adjustments).toEqual([]);
  });

  it('always produces a timeline that still satisfies the Timeline schema', () => {
    const result = optimizeTiming(
      buildTimeline(
        [
          buildClip('clp_a', { startMs: 0, endMs: 1_040 }),
          buildClip('clp_b', { startMs: 1_040, endMs: 2_000 }),
        ],
        2_000,
      ),
      context({ beats: [{ timeMs: 1_000, strength: 1, isDownbeat: true }] }),
    );
    expect(() => TimelineSchema.parse(result.timeline)).not.toThrow();
  });
});
