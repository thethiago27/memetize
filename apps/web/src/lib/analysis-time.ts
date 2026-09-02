/**
 * Time helpers for the analysis panel. Two clocks exist: source time (ms into
 * the original song, used by analysis, lyrics, and the edit window) and
 * output time (ms into the rendered video, used by the player).
 */

export interface SourceWindow {
  sourceStartMs: number;
  sourceEndMs: number;
}

export interface TimedRange {
  startMs: number;
  endMs: number;
}

/** Fraction of the song at `ms`, clamped to [0, 1]. */
export function toPercent(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, ms / durationMs));
}

/** Output (video) time to source (song) time. */
export function toSource(outputMs: number, window: SourceWindow): number {
  return window.sourceStartMs + outputMs;
}

/** Source (song) time to output (video) time, or `null` outside the window. */
export function toOutput(sourceMs: number, window: SourceWindow): number | null {
  if (sourceMs < window.sourceStartMs || sourceMs > window.sourceEndMs) return null;
  return sourceMs - window.sourceStartMs;
}

/** The first range containing `ms`, or `null` when none does. */
export function lineAt<T extends TimedRange>(lines: T[], ms: number): T | null {
  return lines.find((line) => ms >= line.startMs && ms < line.endMs) ?? null;
}

/**
 * Keeps at most `max` items by an even stride, always preserving the first
 * and last so the ends of the song stay marked.
 */
export function thin<T>(items: T[], max = 2000): T[] {
  if (items.length <= max || max < 2) return items.slice(0, Math.max(0, max));
  const stride = Math.ceil((items.length - 1) / (max - 1));
  const out: T[] = [];
  for (let i = 0; i < items.length - 1; i += stride) {
    const item = items[i];
    if (item !== undefined) out.push(item);
  }
  const last = items[items.length - 1];
  if (last !== undefined) out.push(last);
  return out;
}

export const MANUAL_WINDOW_MIN_MS = 5_000;
export const MANUAL_WINDOW_MAX_MS = 60_000;

export interface WindowDraft {
  startMs: number;
  endMs: number;
}

/** Nearest downbeat within `toleranceMs`, else `ms` unchanged. */
export function snapToDownbeat(
  ms: number,
  downbeats: readonly number[],
  toleranceMs: number,
): number {
  let best = ms;
  let bestDistance = toleranceMs;
  for (const downbeat of downbeats) {
    const distance = Math.abs(downbeat - ms);
    if (distance <= bestDistance) {
      best = downbeat;
      bestDistance = distance;
    }
  }
  return best;
}

/** Snap tolerance for a track: 2% of its length, at least 250 ms. */
export function snapTolerance(durationMs: number): number {
  return Math.max(250, Math.round(durationMs * 0.02));
}

/** Parses `mm:ss` or `mm:ss.mmm` into milliseconds; `null` when unreadable. */
export function parseTimecode(value: string): number | null {
  const match = /^\s*(\d+):(\d{1,2})(?:\.(\d{1,3}))?\s*$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds >= 60) return null;
  const millis = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
  return minutes * 60_000 + seconds * 1000 + millis;
}

/** `mm:ss`, with `.mmm` only when the value is not a whole second. */
export function formatField(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return millis === 0 ? base : `${base}.${String(millis).padStart(3, '0')}`;
}

/**
 * Keeps a draft inside `[0, durationMs]`. When the whole band would leave the
 * track it slides back without changing its length.
 */
export function clampWindow(draft: WindowDraft, durationMs: number): WindowDraft {
  const length = Math.max(0, draft.endMs - draft.startMs);
  let startMs = draft.startMs;
  let endMs = draft.endMs;
  if (startMs < 0) {
    startMs = 0;
    endMs = Math.min(durationMs, length);
  }
  if (endMs > durationMs) {
    endMs = durationMs;
    startMs = Math.max(0, durationMs - length);
  }
  return { startMs: Math.round(startMs), endMs: Math.round(endMs) };
}

/** Lyric lines that overlap `[startMs, endMs)`. */
export function linesWithin<T extends TimedRange>(lines: T[], startMs: number, endMs: number): T[] {
  return lines.filter((line) => line.endMs > startMs && line.startMs < endMs);
}

/** Why a draft cannot be saved, in Portuguese, or `null` when it can. */
export function windowProblem(draft: WindowDraft, durationMs: number): string | null {
  if (draft.startMs < 0 || draft.endMs > durationMs) return 'Fora da música';
  if (draft.endMs <= draft.startMs) return 'O fim precisa vir depois do início';
  const length = draft.endMs - draft.startMs;
  if (length < MANUAL_WINDOW_MIN_MS) return 'Mínimo de 5 segundos';
  if (length > MANUAL_WINDOW_MAX_MS) return 'Máximo de 60 segundos';
  return null;
}
