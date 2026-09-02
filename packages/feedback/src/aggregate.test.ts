import { describe, expect, it } from 'vitest';
import { aggregateFeedback, rejectionKey, smoothedRate } from './aggregate';
import type { FeedbackEventLike } from './types';

let counter = 0;
function event(
  partial: Partial<FeedbackEventLike> & { kind: FeedbackEventLike['kind'] },
): FeedbackEventLike {
  counter += 1;
  return {
    id: `fb_${String(counter).padStart(4, '0')}`,
    seq: counter,
    projectId: null,
    timelineVersion: null,
    clipId: null,
    segmentId: null,
    momentId: null,
    assetId: null,
    value: null,
    note: null,
    context: {},
    source: 'USER',
    createdAt: new Date(counter * 1000),
    ...partial,
  };
}

describe('aggregateFeedback', () => {
  it('is neutral with no events', () => {
    const aggregate = aggregateFeedback([]);
    expect(aggregate.usage.size).toBe(0);
    expect(aggregate.cutoffAt).toBeNull();
    expect(aggregate.eventCount).toBe(0);
    expect(smoothedRate(0, 0)).toBe(0.5);
  });

  it('counts swaps and thumbs globally and per narrative function', () => {
    const aggregate = aggregateFeedback([
      event({
        kind: 'SWAP_OUT',
        projectId: 'prj_1',
        segmentId: 'seg_1',
        momentId: 'mom_a',
        context: { narrativeFunction: 'Payoff' },
      }),
      event({
        kind: 'SWAP_IN',
        projectId: 'prj_1',
        segmentId: 'seg_1',
        momentId: 'mom_b',
        context: { narrativeFunction: 'payoff' },
      }),
      event({ kind: 'CLIP_UP', momentId: 'mom_b', context: { narrativeFunction: 'setup' } }),
      event({ kind: 'CLIP_DOWN', momentId: 'mom_a', context: {} }),
    ]);
    const a = aggregate.usage.get('mom_a');
    const b = aggregate.usage.get('mom_b');
    expect(a).toMatchObject({ wins: 0, losses: 2 });
    expect(a?.byFunction.get('payoff')).toEqual({ wins: 0, losses: 1 });
    expect(b).toMatchObject({ wins: 2, losses: 0 });
    expect(b?.byFunction.get('payoff')).toEqual({ wins: 1, losses: 0 });
    expect(b?.byFunction.get('setup')).toEqual({ wins: 1, losses: 0 });
    expect([...(b?.projects ?? [])]).toEqual(['prj_1']);
    expect([...(aggregate.rejectedBySegment.get(rejectionKey('prj_1', 'seg_1')) ?? [])]).toEqual([
      'mom_a',
    ]);
  });

  it('spreads video ratings over placements and records project usage from PLACED', () => {
    const aggregate = aggregateFeedback([
      event({ kind: 'PLACED', projectId: 'prj_1', momentId: 'mom_a', source: 'SYSTEM' }),
      event({ kind: 'PLACED', projectId: 'prj_2', momentId: 'mom_a', source: 'SYSTEM' }),
      event({
        kind: 'VIDEO_RATING',
        projectId: 'prj_1',
        value: 5,
        context: {
          placements: [
            { momentId: 'mom_a', segmentId: 'seg_1', narrativeFunction: 'setup' },
            { momentId: 'mom_b', segmentId: 'seg_2', narrativeFunction: 'payoff' },
          ],
        },
      }),
      event({
        kind: 'VIDEO_RATING',
        projectId: 'prj_2',
        value: 1,
        context: {
          placements: [{ momentId: 'mom_a', segmentId: 'seg_9', narrativeFunction: 'setup' }],
        },
      }),
      event({
        kind: 'VIDEO_RATING',
        projectId: 'prj_3',
        value: 3,
        context: {
          placements: [{ momentId: 'mom_b', segmentId: 'seg_3', narrativeFunction: 'payoff' }],
        },
      }),
    ]);
    const a = aggregate.usage.get('mom_a');
    expect(a).toMatchObject({ wins: 1, losses: 1 });
    expect(a?.byFunction.get('setup')).toEqual({ wins: 1, losses: 1 });
    expect([...(a?.projects ?? [])].sort()).toEqual(['prj_1', 'prj_2']);
    expect(aggregate.usage.get('mom_b')).toMatchObject({ wins: 1, losses: 0 });
  });

  it('honours the before cutoff and reports the newest considered timestamp', () => {
    const early = event({ kind: 'CLIP_UP', momentId: 'mom_a' });
    const late = event({ kind: 'CLIP_DOWN', momentId: 'mom_a' });
    const aggregate = aggregateFeedback([late, early], { before: late.createdAt });
    expect(aggregate.usage.get('mom_a')).toMatchObject({ wins: 1, losses: 0 });
    expect(aggregate.cutoffAt).toEqual(early.createdAt);
    expect(aggregate.eventCount).toBe(1);
  });

  it('resolves bans in order', () => {
    const aggregate = aggregateFeedback([
      event({ kind: 'BAN_MOMENT', momentId: 'mom_a', assetId: 'ast_1' }),
      event({ kind: 'BAN_ASSET', assetId: 'ast_2' }),
      event({ kind: 'UNBAN_MOMENT', momentId: 'mom_a', assetId: 'ast_1' }),
    ]);
    expect(aggregate.bans.momentIds.size).toBe(0);
    expect([...aggregate.bans.assetIds]).toEqual(['ast_2']);
  });
});
