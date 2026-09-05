import { DEFAULT_CANVAS, Timeline } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { type AssembleMoment, type AssembleSegmentMatch, assembleTimeline } from './assemble';
import { InsufficientCatalogError } from './coverage';

function match(overrides: Partial<AssembleSegmentMatch> = {}): AssembleSegmentMatch {
  return { ranked: [], shortlist: [], ...overrides };
}

function moment(assetId: string, startMs: number, durationMs: number): AssembleMoment {
  return { assetId, startMs, endMs: startMs + durationMs, durationMs };
}

const baseParams = {
  projectId: 'prj_1',
  window: { sourceStartMs: 0, sourceEndMs: 2_000, durationMs: 2_000 },
  audioPath: 'storage/audio/prj_1/original.mp3',
  beats: [0, 1_000, 2_000],
};

describe('assembleTimeline', () => {
  it('tiles a short primary with a second eligible moment instead of leaving a source-short clip', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_short', moment('ast_1', 4_000, 1_000)],
      ['mom_fill', moment('ast_2', 0, 1_000)],
    ]);
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [{ segmentId: 'nar_1', momentId: 'mom_short' }],
      segments: [{ id: 'nar_1', startMs: 0, endMs: 2_000 }],
      moments,
      matches: new Map([
        [
          'nar_1',
          match({
            ranked: [
              {
                momentId: 'mom_short',
                assetId: 'ast_1',
                semanticScore: 0.8,
                emotionScore: 1,
                narrativeScore: 1,
                durationScore: 1,
                energyScore: 1,
                qualityScore: 1,
                noveltyScore: 1,
                usageScore: 1,
                finalScore: 0.8,
              },
              {
                momentId: 'mom_fill',
                assetId: 'ast_2',
                semanticScore: 0.7,
                emotionScore: 1,
                narrativeScore: 1,
                durationScore: 1,
                energyScore: 1,
                qualityScore: 1,
                noveltyScore: 1,
                usageScore: 1,
                finalScore: 0.7,
              },
            ],
            shortlist: [
              { momentId: 'mom_short', assetId: 'ast_1', finalScore: 0.8, penalties: [] },
              { momentId: 'mom_fill', assetId: 'ast_2', finalScore: 0.7, penalties: [] },
            ],
          }),
        ],
      ]),
    });

    expect(timeline.clips).toHaveLength(2);
    expect(timeline.clips[0]?.timeline).toEqual({ startMs: 0, endMs: 1_000 });
    expect(timeline.clips[1]?.timeline).toEqual({ startMs: 1_000, endMs: 2_000 });
    expect(
      timeline.clips.every(
        (clip) =>
          clip.source.endMs - clip.source.startMs === clip.timeline.endMs - clip.timeline.startMs,
      ),
    ).toBe(true);
    expect(timeline.audio.sourceStartMs).toBe(0);
    expect(timeline.durationMs).toBe(2_000);
  });

  it('cuts the source to the segment length and reserves a transition handle (F05)', () => {
    const moments = new Map<string, AssembleMoment>([['mom_long', moment('ast_1', 1_000, 5_000)]]);
    const timeline = assembleTimeline({
      ...baseParams,
      window: { sourceStartMs: 0, sourceEndMs: 1_200, durationMs: 1_200 },
      beats: [0, 1_200],
      picks: [{ segmentId: 'nar_1', momentId: 'mom_long' }],
      segments: [{ id: 'nar_1', startMs: 0, endMs: 1_200 }],
      moments,
      matches: new Map(),
    });

    // 2800ms of spare room: coverage reserves the 250ms handle head margin, so
    // the 1200ms take starts at moment.startMs + 250 and leaves tail room too.
    expect(timeline.clips[0]?.source).toEqual({ assetId: 'ast_1', startMs: 1_250, endMs: 2_450 });
  });

  it('orders clips by timeline.startMs regardless of pick order', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_a', moment('ast_a', 0, 1_000)],
      ['mom_b', moment('ast_b', 0, 1_000)],
    ]);
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [
        { segmentId: 'nar_late', momentId: 'mom_b' },
        { segmentId: 'nar_early', momentId: 'mom_a' },
      ],
      segments: [
        { id: 'nar_early', startMs: 0, endMs: 1_000 },
        { id: 'nar_late', startMs: 1_000, endMs: 2_000 },
      ],
      moments,
      matches: new Map(),
    });

    expect(timeline.clips.map((clip) => clip.momentId)).toEqual(['mom_a', 'mom_b']);
  });

  it('defaults to the standard 1080x1920@30 canvas when none is given', () => {
    const timeline = assembleTimeline({
      ...baseParams,
      window: { sourceStartMs: 0, sourceEndMs: 1_000, durationMs: 1_000 },
      beats: [0, 1_000],
      picks: [{ segmentId: 'nar_1', momentId: 'mom_1' }],
      segments: [{ id: 'nar_1', startMs: 0, endMs: 1_000 }],
      moments: new Map([['mom_1', moment('ast_1', 0, 1_000)]]),
      matches: new Map(),
    });
    expect(timeline.canvas).toEqual(DEFAULT_CANVAS);
  });

  it('reads reason.semanticScore from the ranked candidate, falling back to the shortlist finalScore', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_ranked', moment('ast_1', 0, 1_000)],
      ['mom_unranked', moment('ast_2', 0, 1_000)],
    ]);
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [
        { segmentId: 'nar_1', momentId: 'mom_ranked' },
        { segmentId: 'nar_2', momentId: 'mom_unranked' },
      ],
      segments: [
        { id: 'nar_1', startMs: 0, endMs: 1_000 },
        { id: 'nar_2', startMs: 1_000, endMs: 2_000 },
      ],
      moments,
      matches: new Map([
        [
          'nar_1',
          match({
            ranked: [
              {
                momentId: 'mom_ranked',
                assetId: 'ast_1',
                semanticScore: 0.94,
                emotionScore: 0.5,
                narrativeScore: 0.5,
                durationScore: 0.5,
                energyScore: 0.5,
                qualityScore: 0.5,
                noveltyScore: 1,
                usageScore: 1,
                finalScore: 0.88,
              },
            ],
            shortlist: [
              { momentId: 'mom_ranked', assetId: 'ast_1', finalScore: 0.88, penalties: [] },
            ],
          }),
        ],
        [
          'nar_2',
          match({
            shortlist: [
              { momentId: 'mom_unranked', assetId: 'ast_2', finalScore: 0.7, penalties: [] },
            ],
          }),
        ],
      ]),
    });

    const ranked = timeline.clips.find((clip) => clip.momentId === 'mom_ranked');
    expect(ranked?.reason).toEqual({ segmentId: 'nar_1', semanticScore: 0.94, finalScore: 0.88 });

    const unranked = timeline.clips.find((clip) => clip.momentId === 'mom_unranked');
    expect(unranked?.reason).toEqual({ segmentId: 'nar_2', semanticScore: 0.7, finalScore: 0.7 });
  });

  it('round-trips through the Timeline Zod schema and rebases audio to the window', () => {
    const moments = new Map<string, AssembleMoment>([['mom_1', moment('ast_1', 0, 1_000)]]);
    const timeline = assembleTimeline({
      ...baseParams,
      window: { sourceStartMs: 30_000, sourceEndMs: 31_000, durationMs: 1_000 },
      beats: [30_000, 31_000],
      picks: [{ segmentId: 'nar_1', momentId: 'mom_1' }],
      segments: [{ id: 'nar_1', startMs: 30_000, endMs: 31_000 }],
      moments,
      matches: new Map(),
    });

    expect(Timeline.parse(timeline)).toEqual(timeline);
    expect(timeline.schemaVersion).toBe('1.0');
    expect(timeline.clips[0]?.effects).toEqual([]);
    expect(timeline.clips[0]?.timeline).toEqual({ startMs: 0, endMs: 1_000 });
    expect(timeline.audio.sourceStartMs).toBe(30_000);
  });

  it('places the pick clip style on the primary clip and the transition on the segment tail', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_primary', moment('ast_1', 0, 1_000)],
      ['mom_fill_a', moment('ast_2', 0, 1_000)],
      ['mom_fill_b', moment('ast_3', 0, 1_000)],
    ]);
    const shortlist = [
      { momentId: 'mom_primary', assetId: 'ast_1', finalScore: 0.9, penalties: [] },
      { momentId: 'mom_fill_a', assetId: 'ast_2', finalScore: 0.8, penalties: [] },
      { momentId: 'mom_fill_b', assetId: 'ast_3', finalScore: 0.7, penalties: [] },
    ];
    const timeline = assembleTimeline({
      ...baseParams,
      window: { sourceStartMs: 0, sourceEndMs: 4_000, durationMs: 4_000 },
      beats: [0, 1_000, 2_000, 3_000, 4_000],
      picks: [
        {
          segmentId: 'nar_1',
          momentId: 'mom_primary',
          clipStyle: 'hold',
          transitionOut: 'crossfade',
        },
        { segmentId: 'nar_2', momentId: 'mom_fill_b' },
      ],
      segments: [
        { id: 'nar_1', startMs: 0, endMs: 3_000 },
        { id: 'nar_2', startMs: 3_000, endMs: 4_000 },
      ],
      moments,
      matches: new Map([
        ['nar_1', match({ shortlist })],
        ['nar_2', match({ shortlist: [shortlist[2] as (typeof shortlist)[number]] })],
      ]),
    });

    expect(timeline.clips.map((clip) => clip.momentId)).toEqual([
      'mom_primary',
      'mom_fill_a',
      'mom_fill_b',
      'mom_fill_b',
    ]);
    expect(timeline.clips.map((clip) => clip.direction)).toEqual([
      { clipStyle: 'hold', transitionOut: 'hard' },
      { clipStyle: 'none', transitionOut: 'hard' },
      { clipStyle: 'none', transitionOut: 'crossfade' },
      { clipStyle: 'none', transitionOut: 'hard' },
    ]);
    expect(timeline.clips.every((clip) => clip.transitionOut === undefined)).toBe(true);
  });

  it('throws when the catalog cannot cover a minimum slot', () => {
    expect(() =>
      assembleTimeline({
        ...baseParams,
        window: { sourceStartMs: 0, sourceEndMs: 1_000, durationMs: 1_000 },
        beats: [0, 1_000],
        picks: [],
        segments: [{ id: 'nar_1', startMs: 0, endMs: 1_000 }],
        moments: new Map([['mom_short', moment('ast_1', 0, 500)]]),
        matches: new Map([
          [
            'nar_1',
            match({
              shortlist: [
                { momentId: 'mom_short', assetId: 'ast_1', finalScore: 0.5, penalties: [] },
              ],
            }),
          ],
        ]),
      }),
    ).toThrow(InsufficientCatalogError);
  });
});
