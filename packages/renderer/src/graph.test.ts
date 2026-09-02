import {
  DEFAULT_DIRECTION,
  DEFAULT_TRANSFORM,
  Timeline,
  type TimelineClip,
} from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { buildFfmpegGraph, toFfmpegArgs } from './graph';
import type { ResolvedAssets } from './types';

function clip(overrides: Partial<TimelineClip> & { id: string }): TimelineClip {
  const timeline = overrides.timeline ?? { startMs: 0, endMs: 1000 };
  return {
    id: overrides.id,
    momentId: overrides.momentId ?? `mom_${overrides.id}`,
    timeline,
    source: overrides.source ?? {
      assetId: 'ast_1',
      startMs: 0,
      endMs: timeline.endMs - timeline.startMs,
    },
    transform: overrides.transform ?? DEFAULT_TRANSFORM,
    effects: overrides.effects ?? [],
    direction: overrides.direction ?? DEFAULT_DIRECTION,
    reason: overrides.reason ?? { segmentId: 'nar_1', semanticScore: 0.5, finalScore: 0.5 },
  };
}

function timeline(overrides: {
  durationMs: number;
  clips: TimelineClip[];
  sourceStartMs?: number;
}): Timeline {
  return Timeline.parse({
    projectId: 'prj_1',
    durationMs: overrides.durationMs,
    audio: {
      path: 'storage/audio/prj_1/original.mp3',
      timelineStartMs: 0,
      sourceStartMs: overrides.sourceStartMs ?? 0,
    },
    clips: overrides.clips,
  });
}

function assetsFor(clips: readonly TimelineClip[], audioDurationMs = 120_000): ResolvedAssets {
  return {
    audioPath: '/abs/storage/audio/prj_1/original.mp3',
    audioDurationMs,
    clips: clips.map((c) => ({
      clipId: c.id,
      videoPath: `/abs/storage/assets/${c.source.assetId}/proxy.mp4`,
    })),
  };
}

describe('buildFfmpegGraph', () => {
  it('builds a continuous graph without black fillers or clone padding', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 60_000 } })];
    const tl = timeline({ durationMs: 60_000, clips, sourceStartMs: 30_000 });
    const graph = buildFfmpegGraph(tl, assetsFor(clips, 120_000));

    expect(graph.filterComplex).not.toContain('color=c=black');
    expect(graph.filterComplex).not.toContain('tpad=stop_mode=clone');
    expect(graph.filterComplex).toContain(
      'atrim=start=30.000:duration=60.000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.120,afade=t=out:st=59.750:d=0.250',
    );
    expect(graph.filterComplex).toMatch(/trim=start=0\.000:end=60\.000/);
    expect(graph.durationMs).toBe(60_000);
    expect(graph.inputs[0]).toEqual({
      path: '/abs/storage/audio/prj_1/original.mp3',
      kind: 'audio',
    });
    expect(graph.inputs[1]?.kind).toBe('video');
  });

  it('concatenates adjacent clips with a matching segment count', () => {
    const clips = [
      clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } }),
      clip({ id: 'clp_2', timeline: { startMs: 1000, endMs: 3000 } }),
    ];
    const tl = timeline({ durationMs: 3000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips));

    expect(graph.filterComplex).toMatch(/concat=n=2:v=1:a=0\[vout\]/);
  });

  it('throws when the timeline is empty, gapped, or source-short', () => {
    const empty = timeline({ durationMs: 1000, clips: [] });
    expect(() => buildFfmpegGraph(empty, assetsFor([]))).toThrow(/empty timeline/);

    const gapped = [clip({ id: 'clp_1', timeline: { startMs: 1000, endMs: 2000 } })];
    expect(() =>
      buildFfmpegGraph(timeline({ durationMs: 2000, clips: gapped }), assetsFor(gapped)),
    ).toThrow(/timeline gap/);

    const short = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        source: { assetId: 'ast_1', startMs: 0, endMs: 500 },
      }),
    ];
    expect(() =>
      buildFfmpegGraph(timeline({ durationMs: 2000, clips: short }), assetsFor(short)),
    ).toThrow(/source shorter than slot/);
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

  it('appends a Ken Burns scale+crop after the static transform when a zoom is well formed', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
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

  it('pins SAR to 1:1 on clips so concat accepts landscape proxies', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        effects: [{ type: 'zoom', startMs: 1500, endMs: 2000, from: 1, to: 1.12 }],
      }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 2000, clips }), assetsFor(clips));

    expect(graph.filterComplex).not.toContain('color=c=black');
    expect(graph.filterComplex).toMatch(/eval=frame.*setsar=1\[v0\]/);
  });

  it('throws when a clip has no resolved asset', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } })];
    const tl = timeline({ durationMs: 1000, clips });
    expect(() =>
      buildFfmpegGraph(tl, { audioPath: '/abs/audio.mp3', audioDurationMs: 1000, clips: [] }),
    ).toThrow(/no resolved asset/);
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
