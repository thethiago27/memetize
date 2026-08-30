import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CANVAS,
  TIMELINE_SCHEMA_VERSION,
  Timeline,
  toTimelineJsonSchema,
} from './timeline';

const specExample = {
  schemaVersion: '1.0',
  projectId: 'prj_123',
  canvas: { width: 1080, height: 1920, fps: 30 },
  durationMs: 32000,
  audio: {
    path: 'storage/audio/song.mp3',
    timelineStartMs: 0,
    sourceStartMs: 0,
    volume: 1,
  },
  clips: [
    {
      id: 'clp_001',
      momentId: 'mom_123',
      timeline: { startMs: 0, endMs: 1850 },
      source: { assetId: 'ast_123', startMs: 4210, endMs: 6060 },
      transform: { scale: 1.2, positionX: 0.5, positionY: 0.5, cropMode: 'cover' },
      effects: [{ type: 'zoom', startMs: 1200, endMs: 1850, from: 1, to: 1.12 }],
      reason: { segmentId: 'seg_001', semanticScore: 0.94, finalScore: 0.88 },
    },
  ],
};

describe('Timeline', () => {
  it('parses the spec section 34 example verbatim, including a loose effect', () => {
    const result = Timeline.safeParse(specExample);
    expect(result.success).toBe(true);
    expect(result.success && result.data.clips[0]?.effects[0]?.type).toBe('zoom');
  });

  it('parses with an empty effects array (this increment never plans effects)', () => {
    const result = Timeline.safeParse({
      ...specExample,
      clips: [{ ...specExample.clips[0], effects: [] }],
    });
    expect(result.success).toBe(true);
  });

  it('defaults schemaVersion and canvas when omitted', () => {
    const { schemaVersion: _schemaVersion, canvas: _canvas, ...rest } = specExample;
    const result = Timeline.safeParse(rest);
    expect(result.success).toBe(true);
    expect(result.success && result.data.schemaVersion).toBe(TIMELINE_SCHEMA_VERSION);
    expect(result.success && result.data.canvas).toEqual(DEFAULT_CANVAS);
  });

  it('rejects a float startMs (spec section 4.4: milliseconds are always integers)', () => {
    const invalid = {
      ...specExample,
      clips: [{ ...specExample.clips[0], timeline: { startMs: 0.5, endMs: 1850 } }],
    };
    expect(Timeline.safeParse(invalid).success).toBe(false);
  });

  it('rejects a finalScore outside [0, 1]', () => {
    const invalid = {
      ...specExample,
      clips: [
        {
          ...specExample.clips[0],
          reason: { segmentId: 'seg_001', semanticScore: 0.94, finalScore: 1.4 },
        },
      ],
    };
    expect(Timeline.safeParse(invalid).success).toBe(false);
  });

  it('exports a JSON Schema with $schema and properties (spec section 34)', () => {
    const schema = toTimelineJsonSchema();
    expect(schema.$schema).toBeTruthy();
    expect(schema.properties).toBeTruthy();
  });
});
