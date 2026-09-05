import { toOutput } from './analysis-time';

/**
 * Pure geometry for the timeline strip (editor-transport spec). The strip
 * measures its own width and positions every clip in pixels from these
 * helpers, so a pointer position converts back to time exactly.
 */

export interface TimedClip {
  timeline: { startMs: number; endMs: number };
}

export interface RulerTick {
  ms: number;
  /** Whether the tick carries a timecode label. */
  label: boolean;
}

/** Ticks every 5 s; labels every 10 s, or every 20 s when they would crowd. */
export const TICK_MS = 5_000;
const LABEL_MS = 10_000;
const LABEL_MIN_PX = 56;

export function msToPx(ms: number, durationMs: number, widthPx: number): number {
  if (durationMs <= 0 || widthPx <= 0) return 0;
  return (ms / durationMs) * widthPx;
}

export function pxToMs(px: number, durationMs: number, widthPx: number): number {
  if (durationMs <= 0 || widthPx <= 0) return 0;
  const ms = Math.round((px / widthPx) * durationMs);
  return Math.min(durationMs, Math.max(0, ms));
}

export function rulerTicks(durationMs: number, widthPx: number): RulerTick[] {
  if (durationMs <= 0) return [];
  const pxPerLabel = msToPx(LABEL_MS, durationMs, widthPx);
  const labelEvery = widthPx > 0 && pxPerLabel < LABEL_MIN_PX ? LABEL_MS * 2 : LABEL_MS;
  const ticks: RulerTick[] = [];
  for (let ms = 0; ms <= durationMs; ms += TICK_MS) {
    ticks.push({ ms, label: ms % labelEvery === 0 });
  }
  return ticks;
}

/**
 * The clip under an output position: `startMs <= ms < endMs`. At or past
 * the end of the last clip the last clip answers, so the playhead parked on
 * `durationMs` still has a frame to show.
 */
export function clipAt<T extends TimedClip>(clips: T[], ms: number): T | null {
  const hit = clips.find((clip) => ms >= clip.timeline.startMs && ms < clip.timeline.endMs);
  if (hit) return hit;
  const last = clips[clips.length - 1];
  if (last && ms >= last.timeline.endMs) return last;
  return null;
}

/** Song downbeats that fall inside the edit window, on the output clock. */
export function outputDownbeats(
  downbeatsMs: number[],
  window: { sourceStartMs: number; sourceEndMs: number } | null,
  durationMs: number,
): number[] {
  if (!window) return [];
  const out: number[] = [];
  for (const sourceMs of downbeatsMs) {
    const outputMs = toOutput(sourceMs, window);
    if (outputMs !== null && outputMs <= durationMs) out.push(outputMs);
  }
  return out;
}

/** `mm:ss.d` for the transport bar: readable while it runs, unlike frames. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const total = Math.floor(clamped / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const tenth = Math.floor((clamped % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenth}`;
}
