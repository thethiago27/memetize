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
    ...(overrides.transitionOut ? { transitionOut: overrides.transitionOut } : {}),
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
    // Frame-grid alignment clones at most a few frames per cut (`stop=`); a
    // timed clone pad (`stop_duration=`) would be a freeze-frame filler.
    expect(graph.filterComplex).not.toContain('tpad=stop_mode=clone:stop_duration');
    expect(graph.filterComplex).toContain('trim=end_frame=1800');
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

    expect(graph.filterComplex).toMatch(/concat=n=2:v=1:a=0,fps=30,settb=1\/30\[vout\]/);
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

describe('buildFfmpegGraph: cut styles', () => {
  it('crossfades two clips with xfade, extending each side by half the duration', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        source: { assetId: 'ast_1', startMs: 1000, endMs: 3000 },
        transitionOut: { style: 'crossfade', durationMs: 300, requested: 'crossfade' },
      }),
      clip({
        id: 'clp_2',
        timeline: { startMs: 2000, endMs: 4000 },
        source: { assetId: 'ast_2', startMs: 1000, endMs: 3000 },
      }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 4000, clips }), assetsFor(clips));

    expect(graph.filterComplex).toMatch(/\[1:v\]trim=start=1\.000:end=3\.150,/);
    expect(graph.filterComplex).toMatch(/\[2:v\]trim=start=0\.850:end=3\.000,/);
    expect(graph.filterComplex).toContain(
      // 300 ms = 9 frames; the left segment is 60 slot frames + 5 tail frames.
      '[v0][v1]xfade=transition=fade:duration=0.300000:offset=1.866667[vout]',
    );
    expect(graph.filterComplex).not.toContain('concat=');
    expect(graph.durationMs).toBe(4000);
  });

  it('pins fps on every segment when any boundary uses xfade', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        source: { assetId: 'ast_1', startMs: 1000, endMs: 3000 },
        transitionOut: { style: 'whip', durationMs: 200, requested: 'whip' },
      }),
      clip({
        id: 'clp_2',
        timeline: { startMs: 2000, endMs: 4000 },
        source: { assetId: 'ast_2', startMs: 1000, endMs: 3000 },
      }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 4000, clips }), assetsFor(clips));
    expect(graph.filterComplex.match(/fps=30/g)).toHaveLength(2);
    expect(graph.filterComplex).toContain(
      'xfade=transition=slideleft:duration=0.200000:offset=1.900000',
    );
  });

  it('chains concat and xfade left to right with offsets from the accumulated length', () => {
    const clips = [
      clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 1000 } }),
      clip({
        id: 'clp_2',
        timeline: { startMs: 1000, endMs: 3000 },
        source: { assetId: 'ast_2', startMs: 1000, endMs: 3000 },
        transitionOut: { style: 'whip', durationMs: 200, requested: 'whip' },
      }),
      clip({
        id: 'clp_3',
        timeline: { startMs: 3000, endMs: 5000 },
        source: { assetId: 'ast_3', startMs: 1000, endMs: 3000 },
      }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 5000, clips }), assetsFor(clips));

    // The concat that feeds an xfade must restore the 1/fps time base (F04).
    expect(graph.filterComplex).toContain('[v0][v1]concat=n=2:v=1:a=0,fps=30,settb=1/30[acc1]');
    // Accumulated 1000 + 2000 + 100 handle = 3100 ms; offset = 3100 - 200.
    expect(graph.filterComplex).toContain(
      '[acc1][v2]xfade=transition=slideleft:duration=0.200000:offset=2.900000[vout]',
    );
  });

  it('fades through black or white on each side and keeps concat', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        transitionOut: { style: 'dip_black', durationMs: 300, requested: 'dip_black' },
      }),
      clip({
        id: 'clp_2',
        timeline: { startMs: 2000, endMs: 4000 },
        transitionOut: { style: 'flash', durationMs: 100, requested: 'flash' },
      }),
      clip({ id: 'clp_3', timeline: { startMs: 4000, endMs: 6000 } }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 6000, clips }), assetsFor(clips));

    expect(graph.filterComplex).toContain('fade=t=out:st=1.850:d=0.150:color=black');
    expect(graph.filterComplex).toContain('fade=t=in:st=0:d=0.150:color=black');
    expect(graph.filterComplex).toContain('fade=t=out:st=1.950:d=0.050:color=white');
    expect(graph.filterComplex).toContain('fade=t=in:st=0:d=0.050:color=white');
    expect(graph.filterComplex).toContain('concat=n=3:v=1:a=0,fps=30,settb=1/30[vout]');
    expect(graph.filterComplex).not.toContain('xfade');
  });

  it('freezes a held tail and stretches the freeze through an outgoing crossfade', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        source: { assetId: 'ast_1', startMs: 0, endMs: 2000 },
        effects: [{ type: 'hold', startMs: 1500, endMs: 2000, requested: 'hold' }],
        transitionOut: { style: 'crossfade', durationMs: 300, requested: 'crossfade' },
      }),
      clip({
        id: 'clp_2',
        timeline: { startMs: 2000, endMs: 4000 },
        source: { assetId: 'ast_2', startMs: 1000, endMs: 3000 },
      }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 4000, clips }), assetsFor(clips));

    // Motion part only, then the frozen frame for 500 + 150 ms.
    expect(graph.filterComplex).toMatch(/\[1:v\]trim=start=0\.000:end=1\.500,/);
    expect(graph.filterComplex).toContain('tpad=stop_mode=clone:stop_duration=0.650');
    expect(graph.filterComplex).toContain(
      'xfade=transition=fade:duration=0.300000:offset=1.866667',
    );
  });

  it('applies speed before zoom and hold, trimming less source for a slow-down', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        source: { assetId: 'ast_1', startMs: 0, endMs: 2000 },
        effects: [
          { type: 'speed', startMs: 0, endMs: 2000, factor: 0.8, requested: 'slow_down' },
          { type: 'zoom', startMs: 1350, endMs: 2000, from: 1, to: 1.12 },
        ],
      }),
      clip({
        id: 'clp_2',
        timeline: { startMs: 2000, endMs: 4000 },
        source: { assetId: 'ast_2', startMs: 0, endMs: 2500 },
        effects: [
          { type: 'speed', startMs: 2000, endMs: 4000, factor: 1.25, requested: 'speed_up' },
          { type: 'hold', startMs: 3500, endMs: 4000, requested: 'hold' },
        ],
      }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 4000, clips }), assetsFor(clips));
    const [first, second] = graph.filterComplex.split(';');

    expect(first).toMatch(/trim=start=0\.000:end=1\.600,/);
    expect(first?.indexOf('setpts=PTS/0.8')).toBeLessThan(first?.indexOf('eval=frame') ?? -1);

    // Sped-up: motion part is (2000 - 500) * 1.25 = 1875 ms of source.
    expect(second).toMatch(/trim=start=0\.000:end=1\.875,/);
    expect(second?.indexOf('setpts=PTS/1.25')).toBeLessThan(
      second?.indexOf('tpad=stop_mode=clone') ?? -1,
    );
    expect(second).toContain('tpad=stop_mode=clone:stop_duration=0.500');
  });

  it('ignores a transition on the last clip', () => {
    const clips = [
      clip({
        id: 'clp_1',
        timeline: { startMs: 0, endMs: 2000 },
        transitionOut: { style: 'crossfade', durationMs: 300, requested: 'crossfade' },
      }),
    ];
    const graph = buildFfmpegGraph(timeline({ durationMs: 2000, clips }), assetsFor(clips));
    expect(graph.filterComplex).not.toContain('xfade');
    expect(graph.filterComplex).toMatch(/trim=start=0\.000:end=2\.000,/);
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

describe('buildFfmpegGraph with burned-in subtitles', () => {
  it('is byte-identical to the current graph when no cues are passed', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 2000 } })];
    const tl = timeline({ durationMs: 2000, clips });
    const assets = assetsFor(clips);
    expect(buildFfmpegGraph(tl, assets).filterComplex).toBe(
      buildFfmpegGraph(tl, assets, { subtitles: [] }).filterComplex,
    );
  });

  it('joins to [vjoin] then overlays each PNG onto [vout]', () => {
    const clips = [clip({ id: 'clp_1', timeline: { startMs: 0, endMs: 4000 } })];
    const tl = timeline({ durationMs: 4000, clips });
    const graph = buildFfmpegGraph(tl, assetsFor(clips), {
      subtitles: [
        {
          pngPath: '/tmp/cue-0.png',
          startMs: 0,
          endMs: 1500,
          width: 400,
          height: 80,
        },
        {
          pngPath: '/tmp/cue-1.png',
          startMs: 1500,
          endMs: 3000,
          width: 360,
          height: 72,
        },
      ],
    });

    expect(graph.filterComplex).toContain('[vjoin]');
    // Half-open windows: `between` is inclusive at both ends, so at t=1.500
    // both cues would have been enabled and the captions would stack.
    expect(graph.filterComplex).toContain("enable='gte(t,0.000)*lt(t,1.500)'");
    expect(graph.filterComplex).toContain("enable='gte(t,1.500)*lt(t,3.000)'");
    expect(graph.filterComplex).toMatch(/\[vjoin\]\[2:v\]overlay=.*\[vs0\]/);
    expect(graph.filterComplex).toMatch(/\[vs0\]\[3:v\]overlay=.*\[vout\]/);
    expect(graph.inputs.map((input) => input.kind)).toEqual(['audio', 'video', 'image', 'image']);
    expect(graph.inputs[2]?.path).toBe('/tmp/cue-0.png');
    expect(graph.filterComplex).not.toMatch(/concat=n=1:v=1:a=0\[vout\]/);
  });
});
