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
  const durationMs = overrides.durationMs ?? 4000;
  return {
    exists: true,
    durationMs,
    width: 1080,
    height: 1920,
    fpsMilli: 30000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    videoDurationMs: durationMs,
    audioDurationMs: durationMs,
    videoStartMs: 0,
    audioStartMs: 0,
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
    const result = validateOutput(
      probe({ durationMs: 4080, videoDurationMs: 4080, audioDurationMs: 4080 }),
      timeline(4000),
    );
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

  it('rejects a container whose stream coverage is unknown instead of assuming it (F07)', () => {
    const result = validateOutput(
      probe({ durationMs: 60_000, videoDurationMs: null, audioDurationMs: null }),
      timeline(60_000),
    );
    expect(result.valid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'STREAM_COVERAGE_UNKNOWN' }),
    );
    // A known video but unknown audio is just as unproven.
    const audioUnknown = validateOutput(
      probe({ durationMs: 60_000, videoDurationMs: 60_000, audioDurationMs: null }),
      timeline(60_000),
    );
    expect(audioUnknown.valid).toBe(false);
  });

  it('rejects a stream that starts later than the tolerance (F07)', () => {
    const result = validateOutput(
      probe({ durationMs: 4000, videoStartMs: 500, audioStartMs: 0 }),
      timeline(4000),
    );
    expect(result.valid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'STREAM_START_OFFSET' }),
    );
    // Encoder priming inside the audio tolerance is fine; an unknown start is not held against it.
    expect(validateOutput(probe({ audioStartMs: 40 }), timeline(4000)).valid).toBe(true);
    expect(validateOutput(probe({ audioStartMs: null }), timeline(4000)).valid).toBe(true);
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

  it('tolerates a video stream that ends somewhat before the audio, as a warning', () => {
    // 58867 ms of video under 60 s of audio: a real render whose sources ended
    // early. Accepted (98% coverage) with a DURATION_DRIFT warning.
    const result = validateOutput(
      probe({ durationMs: 60_000, videoDurationMs: 58_867, audioDurationMs: 60_000 }),
      timeline(60_000),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'DURATION_DRIFT', durationMs: 1133 }),
    );
    // Below the coverage floor it is a truncated render, not a tolerable shortfall.
    const truncated = validateOutput(
      probe({ durationMs: 60_000, videoDurationMs: 45_000, audioDurationMs: 60_000 }),
      timeline(60_000),
    );
    expect(truncated.valid).toBe(false);
    // A video longer than the tolerance is never accepted silently.
    const longer = validateOutput(
      probe({ durationMs: 60_000, videoDurationMs: 61_000, audioDurationMs: 60_000 }),
      timeline(60_000),
    );
    expect(longer.valid).toBe(false);
  });
});
