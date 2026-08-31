import type { BeatPoint } from '@memetize/contracts';
import { DOWNBEAT_MERGE_TOLERANCE_MS, DOWNBEAT_STRENGTH } from './constants';
import type { TimingBeat } from './types';

/**
 * Fuses the Audio Analyzer's `beats` (which carry onset strength) and
 * `downbeats` (plain timestamps) into one sorted list `optimizeTiming` can
 * search (spec section 32 treats beats/downbeats/onset as inputs to the
 * same alignment decision). A downbeat within `DOWNBEAT_MERGE_TOLERANCE_MS`
 * of an existing beat just flags that beat instead of duplicating it; a
 * downbeat with no nearby beat is structurally important enough to stand
 * on its own with the maximum strength.
 */
export function mergeBeats(
  beats: readonly BeatPoint[],
  downbeats: readonly number[],
): TimingBeat[] {
  const merged: TimingBeat[] = beats.map((beat) => ({
    timeMs: beat.timeMs,
    strength: beat.strength,
    isDownbeat: false,
  }));

  for (const downbeatMs of downbeats) {
    const nearby = merged.find(
      (beat) => Math.abs(beat.timeMs - downbeatMs) <= DOWNBEAT_MERGE_TOLERANCE_MS,
    );
    if (nearby) {
      nearby.isDownbeat = true;
    } else {
      merged.push({ timeMs: downbeatMs, strength: DOWNBEAT_STRENGTH, isDownbeat: true });
    }
  }

  return merged.sort((a, b) => a.timeMs - b.timeMs);
}
