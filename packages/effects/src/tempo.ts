import { DEFAULT_BEAT_MS } from './constants';

/**
 * Milliseconds per beat from the audio analysis' BPM. A project with no
 * analysis, or a degenerate tempo, gets `DEFAULT_BEAT_MS` so cut-style
 * durations still resolve deterministically.
 */
export function beatMsFromBpm(bpm: number | null | undefined): number {
  if (bpm === null || bpm === undefined || !Number.isFinite(bpm) || bpm <= 0) {
    return DEFAULT_BEAT_MS;
  }
  return Math.round(60_000 / bpm);
}
