import { Timeline } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import type { OutputProbe } from './types';
import { validateOutput } from './validate-output';

function timeline(durationMs: number): Timeline {
  return Timeline.parse({
    projectId: 'prj_1',
    durationMs,
    audio: { path: 'storage/audio/prj_1/original.mp3', timelineStartMs: 0, sourceStartMs: 0 },
    clips: [],
  });
}

function probe(overrides: Partial<OutputProbe> = {}): OutputProbe {
  return {
    exists: true,
    durationMs: 4000,
    width: 1080,
    height: 1920,
    fpsMilli: 30000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    videoDurationMs: null,
    audioDurationMs: null,
    ...overrides,
  };
}

describe('validateOutput', () => {
  it('is invalid when the file does not exist', () => {
    const result = validateOutput(probe({ exists: false }), timeline(4000));
    expect(result.valid).toBe(false);
  });

  it('is invalid when the resolution does not match the canvas', () => {
    const result = validateOutput(probe({ width: 1920, height: 1080 }), timeline(4000));
    expect(result.valid).toBe(false);
  });

  it('is invalid when the fps does not match the canvas', () => {
    const result = validateOutput(probe({ fpsMilli: 15000 }), timeline(4000));
    expect(result.valid).toBe(false);
  });

  it('is invalid when there is no audio stream', () => {
    const result = validateOutput(probe({ audioCodec: null }), timeline(4000));
    expect(result.valid).toBe(false);
  });

  it('is invalid when there is no video stream', () => {
    const result = validateOutput(probe({ videoCodec: null }), timeline(4000));
    expect(result.valid).toBe(false);
  });

  it('is valid with no warnings when a small drift is within tolerance', () => {
    const result = validateOutput(probe({ durationMs: 4080 }), timeline(4000));
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === 'DURATION_DRIFT')).toBe(false);
  });

  it('is invalid with a DURATION_DRIFT warning when the drift exceeds tolerance (F07)', () => {
    const result = validateOutput(probe({ durationMs: 4250 }), timeline(4000));
    expect(result.valid).toBe(false);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'DURATION_DRIFT' }));
  });

  it('rejects a 1s render for a 60s timeline (F07)', () => {
    const result = validateOutput(probe({ durationMs: 1000 }), timeline(60_000));
    expect(result.valid).toBe(false);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'DURATION_DRIFT' }));
  });

  it('rejects an unreadable (NaN or zero) duration (F07)', () => {
    expect(validateOutput(probe({ durationMs: Number.NaN }), timeline(4000)).valid).toBe(false);
    expect(validateOutput(probe({ durationMs: 0 }), timeline(4000)).valid).toBe(false);
  });

  it('rejects a short video stream hidden under a full-length container (F07)', () => {
    const result = validateOutput(
      probe({ durationMs: 60_000, videoDurationMs: 1000, audioDurationMs: 60_000 }),
      timeline(60_000),
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.message?.includes('video stream'))).toBe(true);
  });

  it('is valid when both streams cover the timeline', () => {
    const result = validateOutput(
      probe({ durationMs: 60_000, videoDurationMs: 60_000, audioDurationMs: 60_050 }),
      timeline(60_000),
    );
    expect(result.valid).toBe(true);
  });

  it('is valid with no warnings on a perfect match', () => {
    const result = validateOutput(probe(), timeline(4000));
    expect(result).toEqual({ valid: true, warnings: [] });
  });
});
