import type { LyricLine, TranscriptSegment } from '@memetize/contracts';

/**
 * Lyrics parsing (spec section 26). Pure functions of raw file content, so
 * time handling is unit-testable without touching the filesystem or a job.
 * Both parsers clamp bounds to `durationMs` and emit integer milliseconds.
 */

interface RawLine {
  startMs: number;
  text: string;
}

const LRC_LINE = /^\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Parses a `.lrc` file: `[mm:ss.xx]text` per line, ordered by timestamp. */
export function parseLrc(content: string, durationMs: number): LyricLine[] {
  const rawLines: RawLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const match = raw.match(LRC_LINE);
    if (!match) continue;
    const [, minutesRaw, secondsRaw, fractionRaw, textRaw] = match;
    const text = (textRaw ?? '').trim();
    if (text.length === 0) continue;
    const fraction = fractionRaw ?? '0';
    const fractionMs = fraction.length === 2 ? Number(fraction) * 10 : Number(fraction);
    const startMs = Number(minutesRaw) * 60_000 + Number(secondsRaw) * 1000 + fractionMs;
    rawLines.push({ startMs, text });
  }
  rawLines.sort((a, b) => a.startMs - b.startMs);

  return rawLines.map((line, index) => {
    const startMs = clamp(Math.round(line.startMs), 0, durationMs);
    const next = rawLines[index + 1];
    const endMs = clamp(next ? Math.round(next.startMs) : durationMs, startMs, durationMs);
    return { startMs, endMs, text: line.text, words: [] };
  });
}

/** Parses a plain `.txt` file with no timestamps: one line per lyric,
 * dividing the duration evenly (spec section 26). */
export function parseTextLines(content: string, durationMs: number): LyricLine[] {
  const rawLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rawLines.length === 0) return [];

  const sliceMs = Math.floor(durationMs / rawLines.length);
  const lastIndex = rawLines.length - 1;
  return rawLines.map((text, index) => {
    const startMs = clamp(index * sliceMs, 0, durationMs);
    const endMs = index === lastIndex ? durationMs : clamp(startMs + sliceMs, startMs, durationMs);
    return { startMs, endMs, text, words: [] };
  });
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Formats `[mm:ss.xxx]` from integer milliseconds (inverse of `parseLrc`). */
export function formatLrcTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `[${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}]`;
}

/** Serializes timed lyric lines to `.lrc` (`[mm:ss.xxx]text` per line). */
export function formatLrc(lines: Pick<LyricLine, 'startMs' | 'text'>[]): string {
  const body = lines
    .map((line) => ({ startMs: line.startMs, text: line.text.trim() }))
    .filter((line) => line.text.length > 0)
    .map((line) => `${formatLrcTimestamp(line.startMs)}${line.text}`)
    .join('\n');
  return body.length > 0 ? `${body}\n` : '';
}

/** Maps a transcript (spec section 17) onto lyric lines (spec section 26). */
export function segmentsToLyricLines(
  segments: TranscriptSegment[],
  durationMs: number,
): LyricLine[] {
  return segments
    .map((segment) => {
      const text = segment.text.trim();
      const startMs = clamp(segment.startMs, 0, durationMs);
      const endMs = clamp(Math.max(segment.endMs, startMs), startMs, durationMs);
      return {
        startMs,
        endMs,
        text,
        words: segment.words
          .map((word) => ({
            text: word.text.trim(),
            startMs: clamp(word.startMs, 0, durationMs),
            endMs: clamp(Math.max(word.endMs, word.startMs), 0, durationMs),
          }))
          .filter((word) => word.text.length > 0),
      };
    })
    .filter((line) => line.text.length > 0);
}
