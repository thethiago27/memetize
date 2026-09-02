import {
  DEFAULT_DIRECTION,
  DEFAULT_TRANSFORM,
  type TimelineClip,
  type TimelineTransitionOut,
} from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import {
  buildBoundaryFadeFilters,
  buildHoldFilter,
  buildSpeedFilter,
  handlesFor,
  parseHoldEffect,
  parseSpeedEffect,
  transitionOutOf,
  xfadeTransitionName,
} from './cuts';

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clp_1',
    momentId: 'mom_1',
    timeline: { startMs: 1000, endMs: 3000 },
    source: { assetId: 'ast_1', startMs: 0, endMs: 2000 },
    transform: DEFAULT_TRANSFORM,
    effects: [],
    direction: DEFAULT_DIRECTION,
    reason: { segmentId: 'nar_1', semanticScore: 0.5, finalScore: 0.5 },
    ...overrides,
  };
}

function transition(
  style: TimelineTransitionOut['style'],
  durationMs: number,
): TimelineTransitionOut {
  return { style, durationMs, requested: style };
}

describe('handlesFor', () => {
  it('gives half the duration to each side of an overlapping transition only', () => {
    expect(handlesFor(transition('crossfade', 400), transition('whip', 200))).toEqual({
      headMs: 200,
      tailMs: 100,
    });
    expect(handlesFor(transition('dip_black', 400), transition('flash', 200))).toEqual({
      headMs: 0,
      tailMs: 0,
    });
    expect(handlesFor(null, transition('hard', 0))).toEqual({ headMs: 0, tailMs: 0 });
  });
});

describe('transitionOutOf', () => {
  it('forces the last clip to a hard cut and defaults a clip without one', () => {
    const styled = clip({ transitionOut: transition('whip', 200) });
    expect(transitionOutOf(styled, false)).toEqual(transition('whip', 200));
    expect(transitionOutOf(styled, true)).toEqual({
      style: 'hard',
      durationMs: 0,
      requested: 'whip',
    });
    expect(transitionOutOf(clip(), false)).toEqual({
      style: 'hard',
      durationMs: 0,
      requested: 'hard',
    });
  });
});

describe('buildBoundaryFadeFilters', () => {
  it('fades in through the incoming color and out through the outgoing color', () => {
    expect(
      buildBoundaryFadeFilters({
        incoming: transition('flash', 120),
        outgoing: transition('dip_black', 300),
        segmentMs: 2000,
      }),
    ).toEqual(['fade=t=in:st=0:d=0.060:color=white', 'fade=t=out:st=1.850:d=0.150:color=black']);
  });

  it('emits nothing for hard cuts and overlapping transitions', () => {
    expect(
      buildBoundaryFadeFilters({
        incoming: transition('crossfade', 400),
        outgoing: transition('hard', 0),
        segmentMs: 2000,
      }),
    ).toEqual([]);
  });
});

describe('hold and speed filters', () => {
  it('clones the last frame for the hold plus the outgoing overlap handle', () => {
    expect(buildHoldFilter(500, 0)).toBe('tpad=stop_mode=clone:stop_duration=0.500');
    expect(buildHoldFilter(500, 150)).toBe('tpad=stop_mode=clone:stop_duration=0.650');
  });

  it('rescales presentation timestamps by the factor and skips a factor of one', () => {
    expect(buildSpeedFilter(1.25)).toBe('setpts=PTS/1.25');
    expect(buildSpeedFilter(0.8)).toBe('setpts=PTS/0.8');
    expect(buildSpeedFilter(1)).toBeNull();
  });

  it('maps overlapping styles to xfade transition names', () => {
    expect(xfadeTransitionName('crossfade')).toBe('fade');
    expect(xfadeTransitionName('whip')).toBe('slideleft');
  });
});

describe('parsers', () => {
  it('accepts a hold that ends at the slot end and starts after the slot start', () => {
    const c = clip();
    expect(parseHoldEffect({ type: 'hold', startMs: 2500, endMs: 3000 }, c)).toEqual({
      startMs: 2500,
      endMs: 3000,
    });
    expect(parseHoldEffect({ type: 'hold', startMs: 2500, endMs: 2900 }, c)).toBeNull();
    expect(parseHoldEffect({ type: 'hold', startMs: 1000, endMs: 3000 }, c)).toBeNull();
    expect(parseHoldEffect({ type: 'zoom', startMs: 2500, endMs: 3000 }, c)).toBeNull();
  });

  it('accepts a speed effect spanning the slot with a positive factor', () => {
    const c = clip();
    expect(parseSpeedEffect({ type: 'speed', startMs: 1000, endMs: 3000, factor: 0.8 }, c)).toEqual(
      { factor: 0.8 },
    );
    expect(
      parseSpeedEffect({ type: 'speed', startMs: 1000, endMs: 2000, factor: 0.8 }, c),
    ).toBeNull();
    expect(
      parseSpeedEffect({ type: 'speed', startMs: 1000, endMs: 3000, factor: 0 }, c),
    ).toBeNull();
    expect(parseSpeedEffect({ type: 'speed', startMs: 1000, endMs: 3000 }, c)).toBeNull();
  });
});
