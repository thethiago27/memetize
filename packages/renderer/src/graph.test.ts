import { DEFAULT_TRANSFORM, Timeline, type TimelineClip } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { buildFfmpegGraph, toFfmpegArgs } from './graph';
import type { ResolvedAssets } from './types';

function clip(overrides: Partial<TimelineClip> & { id: string }): TimelineClip {
  return {
    id: overrides.id,
    momentId: overrides.momentId ?? `mom_${overrides.id}`,
    timeline: overrides.timeline ?? { startMs: 0, endMs: 1000 },
    source: overrides.source ?? { assetId: 'ast_1', startMs: 0, endMs: 1000 },
    transform: overrides.transform ?? DEFAULT_TRANSFORM,
    effects: overrides.effects ?? [],
    reason: overrides.reason ?? { segmentId: 'nar_1', semanticScore: 0.5, finalScore: 0.5 },
  };
}

function timeline(overrides: { durationMs: number; clips: TimelineClip[] }): Timeline {
  return Timeline.parse({
    projectId: 'prj_1',
    durationMs: overrides.durationMs,
    audio: { path: 'storage/audio/prj_1/original.mp3', timelineStartMs: 0, sourceStartMs: 0 },
    clips: overrides.clips,
  });
}

function assetsFor(clips: readonly TimelineClip[]): ResolvedAssets {
  return {
    audioPath: '/abs/storage/audio/prj_1/original.mp3',
    clips: clips.map((c) => ({
      clipId: c.id,
      videoPath: `/abs/storage/assets/${c.source.assetId}/proxy.mp4`,
    })),
  };
}

describe('buildFfmpegGraph', () => {
  it('surrounds a single middle clip with black gaps and trims the source', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 1000, endMs: 2000 } })];
    const tl = timeline({ durationMs: 4000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));

    expect(graph.filterComplex).toMatch(/color=c=black:s=1080x1920:r=30:d=1\.000/);
    expect(graph.filterComplex).toMatch(/trim=start=0\.000:end=1\.000/);
    expect(graph.durationMs).toBe(4000);
    expect(graph.inputs[0]).toEqual({
      path: '/abs/storage/audio/prj_1/original.mp3',
      kind: 'audio',
    });
    expect(graph.inputs[1]?.kind).toBe('video');
  });

  it('concatenates gaps and clips with a matching segment count', () => {
    const clips = [
      clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } }),
      clip({ id: 'clp_2', timeline: { startMs: 2000, endMs: 3000 } }),
    ];
    const tl = timeline({ durationMs: 3000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));

    // segments: v0, gap, v1 = 3
    expect(graph.filterComplex).toMatch(/concat=n=3:v=1:a=0\[vout\]/);
  });

  it('applies the crop filter for cropMode "cover"', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } })];
    const tl = timeline({ durationMs: 1000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));
    expect(graph.filterComplex).toContain('crop=1080:1920');
  });

  it('applies the pad filter for cropMode "contain"', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 1000 },
        transform: { ...DEFAULT_TRANSFORM, cropMode: 'contain' },
      }),
    ];
    const tl = timeline({ durationMs: 1000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));
    expect(graph.filterComplex).toContain('pad=1080:1920');
  });

  it('freeze-pads a clip whose source is shorter than its timeline slot', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        source: { assetId: 'ast_1', startMs: 0, endMs: 500 },
      }),
    ];
    const tl = timeline({ durationMs: 2000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));
    expect(graph.filterComplex).toContain('tpad=stop_mode=clone:stop_duration=1.500');
  });

  it('appends a Ken Burns scale+crop after the static transform when a zoom is well formed', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 1000, endMs: 2000 },
        effects: [{ type: 'zoom', startMs: 1500, endMs: 2000, from: 1, to: 1.12 }],
      }),
    ];
    const tl = timeline({ durationMs: 2000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));

    expect(graph.filterComplex).toContain('eval=frame');
    expect(graph.filterComplex).toMatch(/crop=1080:1920:x='\(iw-1080\)\/2'/);
    expect(graph.durationMs).toBe(2000);
    expect(graph.outputArgs).toContain('-t');
    expect(graph.outputArgs[graph.outputArgs.indexOf('-t') + 1]).toBe('2.000');
  });

  it('does not add eval=frame when the clip has no effects', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } })];
    const tl = timeline({ durationMs: 1000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));
    expect(graph.filterComplex).not.toContain('eval=frame');
  });

  it('ignores a malformed zoom and leaves durationMs and outputArgs unchanged', () => {
    const plain = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } })];
    const malformed = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 1000 },
        effects: [{ type: 'zoom', startMs: 0, endMs: 1000 }],
      }),
    ];
    const plainGraph = buildFfmpegGraph(
      timeline({ durationMs: 1000, clips: plain }),
      assetsFor(plain),
    );
    const malformedGraph = buildFfmpegGraph(
      timeline({ durationMs: 1000, clips: malformed }),
      assetsFor(malformed),
    );

    expect(malformedGraph.filterComplex).not.toContain('eval=frame');
    expect(malformedGraph.durationMs).toBe(plainGraph.durationMs);
    expect(malformedGraph.outputArgs).toEqual(plainGraph.outputArgs);
  });

  it('pins SAR to 1:1 on gaps and clips so concat accepts landscape proxies', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 1000, endMs: 2000 },
        effects: [{ type: 'zoom', startMs: 1500, endMs: 2000, from: 1, to: 1.12 }],
      }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 3000, clips }), assetsFor(clips));

    // color= defaults to SAR 1:1; scale+crop of a 16:9 proxy becomes 10240:10239
    // and concat refuses to mix them (RENDER_FFMPEG_ERROR on real songs).
    expect(graph.filterComplex).toContain('color=c=black:s=1080x1920:r=30:d=1.000:sar=1[gap0]');
    expect(graph.filterComplex).toMatch(/eval=frame.*setsar=1\[v0\]/);
    expect(graph.filterComplex).toContain(':sar=1[gap1]');
  });

  it('throws when a clip has no resolved asset', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } })];
    const tl = timeline({ durationMs: 1000, clips });
    expect(() => buildFfmpegGraph(tl, { audioPath: '/abs/audio.mp3', clips: [] })).toThrow(
      /no resolved asset/,
    );
  });
});

describe('toFfmpegArgs', () => {
  it('starts with the quiet flags, includes the codec/output flags, and ends with the output path', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } })];
    const tl = timeline({ durationMs: 1000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));
    const args = toFfmpegArgs(graph, '/abs/storage/renders/prj_1/render_001.mp4');

    expect(args.slice(0, 4)).toEqual(['-y', '-hide_banner', '-loglevel', 'error']);
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(args).toContain('-t');
    expect(args.at(-1)).toBe('/abs/storage/renders/prj_1/render_001.mp4');
    expect(args[4]).toBe('-i');
    expect(args[5]).toBe('/abs/storage/audio/prj_1/original.mp3');
  });
});
