import type { RenderValidation, RenderWarning } from '@memetize/contracts';
import type { Timeline } from '@memetize/timeline';
import { AUDIO_DRIFT_MS, DURATION_DRIFT_MS } from './constants';
import type { OutputProbe } from './types';

/**
 * Checks the rendered MP4 against the `Timeline` it was built from (spec
 * section 38). Hard failures — a missing file, wrong resolution/fps, a missing
 * video/audio stream, an unreadable duration, a stream whose coverage cannot be
 * determined, a stream that starts late, or a duration/stream that drifts beyond
 * tolerance — mean the encode is broken and the `renders` row must never be
 * written (F07). A small, deliberately tolerated drift is only a warning.
 *
 * The container duration alone can hide a truncated stream (e.g. 1s of video
 * under 60s of audio still reports a 60s container), so each stream's span is
 * checked against the timeline separately. Unknown coverage is a failure, not a
 * pass: the probe measures stream spans from packets when the header lacks them,
 * so `null` here means even that failed and nothing proves the stream is whole.
 */
export function validateOutput(probe: OutputProbe, timeline: Timeline): RenderValidation {
  const warnings: RenderWarning[] = [];

  if (!probe.exists) {
    return { valid: false, warnings };
  }

  const { width, height, fps } = timeline.canvas;
  const invalid =
    probe.width !== width ||
    probe.height !== height ||
    probe.fpsMilli !== fps * 1000 ||
    probe.videoCodec === null ||
    probe.audioCodec === null;

  if (invalid) {
    return { valid: false, warnings };
  }

  // An unreadable/zero container duration is a broken probe, not a pass.
  if (!Number.isFinite(probe.durationMs) || probe.durationMs <= 0) {
    warnings.push(driftWarning(probe.durationMs, timeline.durationMs));
    return { valid: false, warnings };
  }

  // Tolerance is at least DURATION_DRIFT_MS, widened to two frames on low fps.
  const maxDriftMs = Math.max(DURATION_DRIFT_MS, Math.ceil(2000 / fps));
  const driftMs = Math.abs(probe.durationMs - timeline.durationMs);
  if (driftMs > maxDriftMs) {
    warnings.push(driftWarning(probe.durationMs, timeline.durationMs));
    return { valid: false, warnings };
  }

  // Each stream must actually cover the timeline; the container duration alone
  // would accept a video stream that ends long before the audio.
  for (const stream of [
    {
      kind: 'video' as const,
      durationMs: probe.videoDurationMs,
      startMs: probe.videoStartMs,
      toleranceMs: maxDriftMs,
    },
    {
      kind: 'audio' as const,
      durationMs: probe.audioDurationMs,
      startMs: probe.audioStartMs,
      toleranceMs: AUDIO_DRIFT_MS,
    },
  ]) {
    if (stream.durationMs === null) {
      warnings.push(unknownCoverageWarning(stream.kind));
      return { valid: false, warnings };
    }
    if (!streamCoversTimeline(stream.durationMs, timeline.durationMs, stream.toleranceMs)) {
      warnings.push(streamWarning(stream.kind, stream.durationMs, timeline.durationMs));
      return { valid: false, warnings };
    }
    if (stream.startMs !== null && Math.abs(stream.startMs) > stream.toleranceMs) {
      warnings.push(startOffsetWarning(stream.kind, stream.startMs));
      return { valid: false, warnings };
    }
  }

  if (driftMs > DURATION_DRIFT_MS) {
    warnings.push(driftWarning(probe.durationMs, timeline.durationMs));
  }

  return { valid: true, warnings };
}

/** A stream covers the timeline when its measured duration is within tolerance. */
function streamCoversTimeline(
  streamDurationMs: number,
  expectedMs: number,
  toleranceMs: number,
): boolean {
  if (!Number.isFinite(streamDurationMs) || streamDurationMs <= 0) return false;
  return Math.abs(streamDurationMs - expectedMs) <= toleranceMs;
}

function unknownCoverageWarning(kind: 'video' | 'audio'): RenderWarning {
  return {
    code: 'STREAM_COVERAGE_UNKNOWN',
    message: `${kind} stream coverage could not be determined from ffprobe; refusing to publish`,
  };
}

function startOffsetWarning(kind: 'video' | 'audio', startMs: number): RenderWarning {
  return {
    code: 'STREAM_START_OFFSET',
    durationMs: Math.max(0, Math.round(Math.abs(startMs))),
    message: `${kind} stream starts at ${startMs}ms instead of 0`,
  };
}

function driftWarning(actualMs: number, expectedMs: number): RenderWarning {
  const driftMs = Number.isFinite(actualMs) ? Math.abs(actualMs - expectedMs) : expectedMs;
  return {
    code: 'DURATION_DRIFT',
    durationMs: Math.max(0, Math.round(driftMs)),
    message: `rendered duration ${actualMs}ms drifts from the timeline's ${expectedMs}ms`,
  };
}

function streamWarning(
  kind: 'video' | 'audio',
  actualMs: number,
  expectedMs: number,
): RenderWarning {
  return {
    code: 'DURATION_DRIFT',
    durationMs: Math.max(0, Math.round(Math.abs(actualMs - expectedMs))),
    message: `${kind} stream duration ${actualMs}ms does not cover the timeline's ${expectedMs}ms`,
  };
}
