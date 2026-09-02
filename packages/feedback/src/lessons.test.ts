import { describe, expect, it } from 'vitest';
import { aggregateFeedback } from './aggregate';
import { buildExamples, buildLessons } from './lessons';
import type { FeedbackEventLike } from './types';

let counter = 0;
function event(
  partial: Partial<FeedbackEventLike> & { kind: FeedbackEventLike['kind'] },
): FeedbackEventLike {
  counter += 1;
  return {
    id: `fb_${String(counter).padStart(4, '0')}`,
    seq: counter,
    projectId: 'prj_1',
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

const describeMoment = (id: string) => ({ mom_a: 'guy shrugs', mom_b: 'cat "stares"' })[id];

describe('buildLessons', () => {
  it('writes one line per shortlisted moment with feedback, then notes newest first', () => {
    const events = [
      event({ kind: 'SWAP_OUT', momentId: 'mom_b', context: { narrativeFunction: 'setup' } }),
      event({ kind: 'SWAP_IN', momentId: 'mom_a', context: { narrativeFunction: 'setup' } }),
      event({ kind: 'CLIP_UP', momentId: 'mom_a', context: { narrativeFunction: 'payoff' } }),
      event({ kind: 'CLIP_UP', momentId: 'mom_a', context: { narrativeFunction: 'payoff' } }),
      event({ kind: 'CLIP_UP', momentId: 'mom_elsewhere', context: {} }),
      event({ kind: 'NOTE', projectId: null, note: 'global taste' }),
      event({ kind: 'NOTE', projectId: 'prj_other', note: 'not mine' }),
      event({ kind: 'NOTE', projectId: 'prj_1', note: 'project taste' }),
    ];
    const lessons = buildLessons({
      aggregate: aggregateFeedback(events),
      events,
      projectId: 'prj_1',
      momentIds: ['mom_b', 'mom_a', 'mom_silent'],
      describe: describeMoment,
    });
    expect(lessons).toEqual([
      'Moment mom_a ("guy shrugs"): 3 positive, 0 negative signals; chosen as payoff 2x; chosen as setup 1x.',
      'Moment mom_b ("cat \'stares\'"): 0 positive, 1 negative signal; rejected as setup 1x.',
      'Editor note: project taste',
      'Editor note: global taste',
    ]);
  });

  it('respects the caps', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      event({ kind: 'CLIP_UP', momentId: `mom_${i}`, context: {} }),
    ).concat(Array.from({ length: 4 }, (_, i) => event({ kind: 'NOTE', note: `n${i}` })));
    const lessons = buildLessons({
      aggregate: aggregateFeedback(events),
      events,
      projectId: 'prj_1',
      momentIds: events.map((e) => e.momentId ?? '').filter(Boolean),
      describe: () => undefined,
      limits: { moments: 2, notes: 1 },
    });
    expect(lessons).toHaveLength(3);
    expect(lessons[2]).toBe('Editor note: n3');
  });
});

describe('buildExamples', () => {
  it('picks the most recent matching swap-in per segment without reuse', () => {
    const events = [
      event({
        kind: 'SWAP_IN',
        momentId: 'mom_a',
        context: { narrativeFunction: 'Setup', emotion: 'joy', meaning: 'old', lyrics: 'l1' },
      }),
      event({
        kind: 'SWAP_IN',
        momentId: 'mom_b',
        context: { narrativeFunction: 'setup', emotion: 'joy', meaning: 'new', lyrics: 'l2' },
      }),
      event({
        kind: 'SWAP_OUT',
        momentId: 'mom_c',
        context: { narrativeFunction: 'payoff', emotion: 'anger' },
      }),
    ];
    const examples = buildExamples({
      events,
      segments: [
        { narrativeFunction: 'setup', emotion: 'JOY' },
        { narrativeFunction: 'setup', emotion: 'joy' },
        { narrativeFunction: 'payoff', emotion: 'anger' },
        { narrativeFunction: 'setup', emotion: 'joy' },
      ],
      describe: describeMoment,
    });
    expect(examples.map((e) => [e.chosenMomentId, e.meaning])).toEqual([
      ['mom_b', 'new'],
      ['mom_a', 'old'],
    ]);
    expect(examples[0]?.chosenDescription).toBe('cat "stares"');
    expect(
      buildExamples({
        events,
        segments: [{ narrativeFunction: 'setup', emotion: 'joy' }],
        describe: describeMoment,
        limit: 0,
      }),
    ).toEqual([]);
  });
});
