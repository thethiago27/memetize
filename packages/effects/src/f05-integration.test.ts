import { type AssembleMoment, assembleDirectedTimeline } from '@memetize/director';
import { optimizeTiming } from '@memetize/timing';
import { describe, expect, it } from 'vitest';
import { resolveCutStyles } from './cut-styles';
import type { CutSourceBounds } from './types';

/**
 * F05: a crossfade the Director requests must survive to the resolved timeline
 * when the moment is long enough, because coverage now reserves the source
 * handles an overlapping transition needs — without any manual source shift in
 * the test. When the moment is exactly slot-sized there is no room and the
 * transition is justifiably downgraded.
 */
describe('F05: pipeline reserves handles for overlapping transitions', () => {
  function buildAndResolve(momentDurationMs: number, beatMs?: number) {
    const moments = new Map<string, AssembleMoment>([
      [
        'mom_a',
        { assetId: 'ast_a', startMs: 0, endMs: momentDurationMs, durationMs: momentDurationMs },
      ],
      [
        'mom_b',
        { assetId: 'ast_b', startMs: 0, endMs: momentDurationMs, durationMs: momentDurationMs },
      ],
    ]);
    const { timeline } = assembleDirectedTimeline({
      projectId: 'prj_f05',
      window: { sourceStartMs: 0, sourceEndMs: 4000, durationMs: 4000 },
      audioPath: 'storage/audio/prj_f05/original.mp3',
      picks: [
        { segmentId: 'nar_1', momentId: 'mom_a', transitionOut: 'crossfade' },
        { segmentId: 'nar_2', momentId: 'mom_b' },
      ],
      segments: [
        { id: 'nar_1', startMs: 0, endMs: 2000 },
        { id: 'nar_2', startMs: 2000, endMs: 4000 },
      ],
      moments,
      matches: new Map(),
      beats: [],
    });

    // Effects receives each moment's full extent as source bounds, exactly like
    // the real EFFECTS worker.
    const sourceBoundsByMomentId = new Map<string, CutSourceBounds>([
      ['mom_a', { startMs: 0, endMs: momentDurationMs }],
      ['mom_b', { startMs: 0, endMs: momentDurationMs }],
    ]);
    // Optionally run the real Timing pass in between, like the pipeline does.
    const timed =
      beatMs === undefined
        ? timeline
        : optimizeTiming(timeline, {
            beats: [{ timeMs: beatMs, strength: 1, isDownbeat: true }],
            segmentFunctionById: new Map(),
            sourceBoundsByMomentId,
          }).timeline;
    return resolveCutStyles(timed, { beatMs: 500, sourceBoundsByMomentId });
  }

  it('keeps a crossfade renderable when the moment has spare source', () => {
    const result = buildAndResolve(4000);
    expect(result.timeline.clips[0]?.transitionOut?.style).toBe('crossfade');
    expect(result.timeline.clips[0]?.transitionOut?.durationMs).toBeGreaterThan(0);
  });

  it('keeps the crossfade after Timing grows the first clip onto a beat (F05)', () => {
    // 2400 ms moments, 2000 ms slots, beat at 2150 ms: Timing extends clip A by
    // 150 ms. Before the fix the whole extension came from A's tail, leaving 50 ms
    // of handle and downgrading the crossfade to dip_black/no_source_handle.
    const result = buildAndResolve(2400, 2150);
    expect(result.timeline.clips[0]?.timeline.endMs).toBe(2150);
    expect(result.timeline.clips[0]?.transitionOut?.style).toBe('crossfade');
  });

  it('downgrades the crossfade when the moment is exactly slot-sized', () => {
    const result = buildAndResolve(2000);
    expect(result.timeline.clips[0]?.transitionOut?.style).not.toBe('crossfade');
  });
});
