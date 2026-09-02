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
