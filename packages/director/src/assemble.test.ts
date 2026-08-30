import { DEFAULT_CANVAS, Timeline } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { type AssembleMoment, type AssembleSegmentMatch, assembleTimeline } from './assemble';

function match(overrides: Partial<AssembleSegmentMatch> = {}): AssembleSegmentMatch {
  return { ranked: [], shortlist: [], ...overrides };
}

const baseParams = {
  projectId: 'prj_1',
  durationMs: 10_000,
  audioPath: 'storage/audio/prj_1/original.mp3',
};

describe('assembleTimeline', () => {
  it('builds one clip per pick, with timeline bounds equal to the segment and source cut to min(moment, segment)', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_short', { assetId: 'ast_1', startMs: 4000, durationMs: 500 }],
    ]);
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [{ segmentId: 'nar_1', momentId: 'mom_short' }],
      segments: [{ id: 'nar_1', startMs: 0, endMs: 2000 }],
      moments,
      matches: new Map([
        [
          'nar_1',
          match({
            shortlist: [
              { momentId: 'mom_short', assetId: 'ast_1', finalScore: 0.8, penalties: [] },
            ],
          }),
        ],
      ]),
    });

    expect(timeline.clips).toHaveLength(1);
    const clip = timeline.clips[0];
    expect(clip?.timeline).toEqual({ startMs: 0, endMs: 2000 });
    // moment (500ms) is shorter than the segment (2000ms): source ends after 500ms, leaving a gap.
    expect(clip?.source).toEqual({ assetId: 'ast_1', startMs: 4000, endMs: 4500 });
  });

  it('cuts the source to the segment length when the moment is longer than the segment', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_long', { assetId: 'ast_1', startMs: 1000, durationMs: 5000 }],
    ]);
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [{ segmentId: 'nar_1', momentId: 'mom_long' }],
      segments: [{ id: 'nar_1', startMs: 0, endMs: 1200 }],
      moments,
      matches: new Map(),
    });

    expect(timeline.clips[0]?.source).toEqual({ assetId: 'ast_1', startMs: 1000, endMs: 2200 });
  });

  it('orders clips by timeline.startMs regardless of pick order', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_a', { assetId: 'ast_a', startMs: 0, durationMs: 1000 }],
      ['mom_b', { assetId: 'ast_b', startMs: 0, durationMs: 1000 }],
    ]);
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [
        { segmentId: 'nar_late', momentId: 'mom_b' },
        { segmentId: 'nar_early', momentId: 'mom_a' },
      ],
      segments: [
        { id: 'nar_early', startMs: 0, endMs: 1000 },
        { id: 'nar_late', startMs: 1000, endMs: 2000 },
      ],
      moments,
      matches: new Map(),
    });

    expect(timeline.clips.map((clip) => clip.momentId)).toEqual(['mom_a', 'mom_b']);
  });

  it('defaults to the standard 1080x1920@30 canvas when none is given', () => {
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [],
      segments: [],
      moments: new Map(),
      matches: new Map(),
    });
    expect(timeline.canvas).toEqual(DEFAULT_CANVAS);
  });

  it('reads reason.semanticScore from the ranked candidate, falling back to the shortlist finalScore', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_ranked', { assetId: 'ast_1', startMs: 0, durationMs: 1000 }],
      ['mom_unranked', { assetId: 'ast_2', startMs: 0, durationMs: 1000 }],
    ]);
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [
        { segmentId: 'nar_1', momentId: 'mom_ranked' },
        { segmentId: 'nar_2', momentId: 'mom_unranked' },
      ],
      segments: [
        { id: 'nar_1', startMs: 0, endMs: 1000 },
        { id: 'nar_2', startMs: 1000, endMs: 2000 },
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

  it('round-trips through the Timeline Zod schema', () => {
    const moments = new Map<string, AssembleMoment>([
      ['mom_1', { assetId: 'ast_1', startMs: 0, durationMs: 1000 }],
    ]);
    const timeline = assembleTimeline({
      ...baseParams,
      picks: [{ segmentId: 'nar_1', momentId: 'mom_1' }],
      segments: [{ id: 'nar_1', startMs: 0, endMs: 1000 }],
      moments,
      matches: new Map(),
    });

    expect(Timeline.parse(timeline)).toEqual(timeline);
    expect(timeline.schemaVersion).toBe('1.0');
    expect(timeline.clips[0]?.effects).toEqual([]);
  });

  it('throws when a pick references a segment or moment outside the given context', () => {
    expect(() =>
      assembleTimeline({
        ...baseParams,
        picks: [{ segmentId: 'nar_missing', momentId: 'mom_1' }],
        segments: [],
        moments: new Map(),
        matches: new Map(),
      }),
    ).toThrow(/unknown segment/);

    expect(() =>
      assembleTimeline({
        ...baseParams,
        picks: [{ segmentId: 'nar_1', momentId: 'mom_missing' }],
        segments: [{ id: 'nar_1', startMs: 0, endMs: 1000 }],
        moments: new Map(),
        matches: new Map(),
      }),
    ).toThrow(/unknown moment/);
  });
});
