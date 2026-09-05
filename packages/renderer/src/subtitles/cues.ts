import type { SubtitleLine } from '@memetize/contracts';
import type { Timeline } from '@memetize/timeline';

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Maps song-time subtitle lines onto the timeline clock (translated-subtitles
 * spec): `t' = t - audio.sourceStartMs + audio.timelineStartMs`. Drops lines
 * outside the window, empty text, and cues shorter than one frame. Overlapping
 * consecutive cues are trimmed so the earlier one ends where the next starts.
 */
export function cuesFromLyrics(lines: readonly SubtitleLine[], timeline: Timeline): SubtitleCue[] {
  const origin = timeline.audio.sourceStartMs - timeline.audio.timelineStartMs;
  const durationMs = timeline.durationMs;
  const fps = timeline.canvas.fps;

  const mapped: SubtitleCue[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length === 0) continue;
    const startMs = Math.max(0, line.startMs - origin);
    const endMs = Math.min(durationMs, line.endMs - origin);
    if (endMs <= 0 || startMs >= durationMs) continue;
    if (endMs <= startMs) continue;
    if (frameSpan(startMs, endMs, fps) < 1) continue;
    mapped.push({ startMs, endMs, text });
  }

  mapped.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const trimmed: SubtitleCue[] = [];
  for (let index = 0; index < mapped.length; index += 1) {
    const cue = mapped[index];
    if (!cue) continue;
    const next = mapped[index + 1];
    const endMs = next && cue.endMs > next.startMs ? next.startMs : cue.endMs;
    if (endMs <= cue.startMs) continue;
    if (frameSpan(cue.startMs, endMs, fps) < 1) continue;
    trimmed.push({ startMs: cue.startMs, endMs, text: cue.text });
  }
  return trimmed;
}

function frameSpan(startMs: number, endMs: number, fps: number): number {
  return Math.round((endMs * fps) / 1000) - Math.round((startMs * fps) / 1000);
}
