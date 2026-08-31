import type { RenderValidation, RenderWarning } from '@memetize/contracts';
import type { Timeline } from '@memetize/timeline';
import { DURATION_DRIFT_MS } from './constants';
import type { OutputProbe } from './types';

/**
 * Checks the rendered MP4 against the `Timeline` it was built from (spec
 * section 38). Hard failures — a missing file, wrong resolution/fps, or a
 * missing video/audio stream — mean the encode itself is broken and the
 * `renders` row must never be written. A duration off by more than
 * `DURATION_DRIFT_MS` still opens fine, so it's a warning, not a failure.
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

  const driftMs = Math.abs(probe.durationMs - timeline.durationMs);
  if (driftMs > DURATION_DRIFT_MS) {
    warnings.push({
      code: 'DURATION_DRIFT',
      durationMs: driftMs,
      message: `rendered duration ${probe.durationMs}ms drifts ${driftMs}ms from the timeline's ${timeline.durationMs}ms`,
    });
  }

  return { valid: true, warnings };
}
