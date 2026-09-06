import type {
  AudioSection,
  BeatPoint,
  EditWindowSelection,
  EnergyPoint,
  LyricLine,
} from '@memetize/contracts';
import {
  BOUNDARY_ENERGY_LOOKBACK_MS,
  HIGHLIGHT_SELECTOR,
  HIGHLIGHT_SELECTOR_VERSION,
  HIGHLIGHT_WEIGHTS,
  MAX_OUTPUT_DURATION_MS,
  STRUCTURAL_ALIGNMENT_TOLERANCE_MS,
} from './constants';

const HIGH_VALUE_SECTIONS = new Set(['chorus', 'payoff', 'climax']);
const LYRIC_BOUNDARY_PROXIMITY_MS = 2_000;

export interface HighlightSelectionInput {
  trackDurationMs: number;
  sections: readonly AudioSection[];
  beats: readonly BeatPoint[];
  downbeats: readonly number[];
  energyCurve: readonly EnergyPoint[];
  lyrics: readonly LyricLine[];
}

export function selectEditWindow(input: HighlightSelectionInput): EditWindowSelection {
  const { trackDurationMs } = input;
  if (!Number.isInteger(trackDurationMs) || trackDurationMs <= 0) {
    throw new Error(
      `HIGHLIGHT_INVALID_ANALYSIS: trackDurationMs must be a positive integer, got ${trackDurationMs}`,
    );
  }

  if (trackDurationMs <= MAX_OUTPUT_DURATION_MS) {
    return scoreWindow(0, trackDurationMs, trackDurationMs, input);
  }

  const candidates = collectCandidateStarts(input);
  const scored = candidates
    .map((startMs) =>
      scoreWindow(startMs, startMs + MAX_OUTPUT_DURATION_MS, MAX_OUTPUT_DURATION_MS, input),
    )
    .sort((a, b) => b.score - a.score || a.sourceStartMs - b.sourceStartMs);

  const winner = scored[0];
  if (!winner) {
    return scoreWindow(0, MAX_OUTPUT_DURATION_MS, MAX_OUTPUT_DURATION_MS, input);
  }
  return winner;
}

function collectCandidateStarts(input: HighlightSelectionInput): number[] {
  const maxStart = input.trackDurationMs - MAX_OUTPUT_DURATION_MS;
  const starts = new Set<number>();
  const add = (raw: number): void => {
    const clamped = Math.min(Math.max(Math.round(raw), 0), maxStart);
    starts.add(clamped);
  };

  add(0);
  add(maxStart);

  const structuralTimes: number[] = [];
  for (const section of input.sections) {
    add(section.startMs);
    add(section.endMs - MAX_OUTPUT_DURATION_MS);
    structuralTimes.push(section.startMs, section.endMs);
  }
  for (const downbeat of input.downbeats) {
    add(downbeat);
    add(downbeat - MAX_OUTPUT_DURATION_MS);
    structuralTimes.push(downbeat);
  }
  for (const lyric of input.lyrics) {
    const nearBoundary = structuralTimes.some(
      (timeMs) => Math.abs(lyric.startMs - timeMs) <= LYRIC_BOUNDARY_PROXIMITY_MS,
    );
    if (nearBoundary) add(lyric.startMs);
  }

  return [...starts];
}

/**
 * Scores an arbitrary range with the highlight weights, so a manual pick can
 * be compared with the selector's own winner. `targetDurationMs` equals the
 * range length: nothing is being fitted.
 */
export function scoreEditWindow(
  sourceStartMs: number,
  sourceEndMs: number,
  input: HighlightSelectionInput,
): EditWindowSelection {
  return scoreWindow(sourceStartMs, sourceEndMs, sourceEndMs - sourceStartMs, input);
}

function scoreWindow(
  sourceStartMs: number,
  sourceEndMs: number,
  targetDurationMs: number,
  input: HighlightSelectionInput,
): EditWindowSelection {
  const durationMs = sourceEndMs - sourceStartMs;
  const section = scoreSection(sourceStartMs, sourceEndMs, input.sections);
  const energy = scoreEnergy(sourceStartMs, sourceEndMs, input.energyCurve);
  const lyrics = scoreLyrics(sourceStartMs, sourceEndMs, durationMs, input.lyrics);
  const narrativeArc = scoreNarrativeArc(sourceStartMs, sourceEndMs, input);
  const boundaries = scoreBoundaries(sourceStartMs, sourceEndMs, input);
  const score = round6(
    section * HIGHLIGHT_WEIGHTS.section +
      energy * HIGHLIGHT_WEIGHTS.energy +
      lyrics * HIGHLIGHT_WEIGHTS.lyrics +
      narrativeArc * HIGHLIGHT_WEIGHTS.narrativeArc +
      boundaries * HIGHLIGHT_WEIGHTS.boundaries,
  );

  return {
    sourceStartMs,
    sourceEndMs,
    durationMs,
    targetDurationMs,
    score,
    scoreBreakdown: {
      section: round6(section),
      energy: round6(energy),
      lyrics: round6(lyrics),
      narrativeArc: round6(narrativeArc),
      boundaries: round6(boundaries),
    },
    selector: HIGHLIGHT_SELECTOR,
    selectorVersion: HIGHLIGHT_SELECTOR_VERSION,
  };
}

function scoreSection(startMs: number, endMs: number, sections: readonly AudioSection[]): number {
  const durationMs = endMs - startMs;
  if (durationMs <= 0) return 0;
  let overlapMs = 0;
  for (const section of sections) {
    if (!HIGH_VALUE_SECTIONS.has(section.type.toLowerCase())) continue;
    overlapMs += overlap(startMs, endMs, section.startMs, section.endMs);
  }
  return clamp01(overlapMs / durationMs);
}

function scoreEnergy(startMs: number, endMs: number, energyCurve: readonly EnergyPoint[]): number {
  const points = energyCurve.filter((point) => point.timeMs >= startMs && point.timeMs <= endMs);
  if (points.length === 0) {
    const nearest = energyAt(Math.floor((startMs + endMs) / 2), energyCurve);
    return nearest ?? 0;
  }
  const mean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  return clamp01(mean);
}

function scoreLyrics(
  startMs: number,
  endMs: number,
  durationMs: number,
  lyrics: readonly LyricLine[],
): number {
  if (durationMs <= 0) return 0;
  let coveredMs = 0;
  for (const line of lyrics) {
    coveredMs += overlap(startMs, endMs, line.startMs, line.endMs);
  }
  return clamp01(coveredMs / durationMs);
}

function scoreNarrativeArc(startMs: number, endMs: number, input: HighlightSelectionInput): number {
  const durationMs = endMs - startMs;
  const firstThirdEnd = startMs + Math.floor(durationMs / 3);
  const finalThirdStart = endMs - Math.floor(durationMs / 3);
  const firstEnergy = scoreEnergy(startMs, firstThirdEnd, input.energyCurve);
  const finalEnergy = scoreEnergy(finalThirdStart, endMs, input.energyCurve);
  const rise = clamp01(finalEnergy - firstEnergy);
  const climaxInFinalThird = scoreSection(finalThirdStart, endMs, input.sections);
  return clamp01(Math.max(rise, climaxInFinalThird));
}

/**
 * How well the window's edges sit on the music: each edge scores up to 0.5 for
 * landing on (or near) a section boundary or downbeat, and the start is
 * penalized for cutting across a jump in energy.
 */
function scoreBoundaries(startMs: number, endMs: number, input: HighlightSelectionInput): number {
  const structural = collectStructuralTimes(input.sections, input.downbeats);
  const alignment = 0.5 * alignmentAt(startMs, structural) + 0.5 * alignmentAt(endMs, structural);

  // Measured across a real interval: the energy curve is sampled coarsely, so
  // comparing `t` with `t - 1ms` returned the same sample every time.
  const energyAtStart = energyAt(startMs, input.energyCurve);
  const energyBefore = energyAt(startMs - BOUNDARY_ENERGY_LOOKBACK_MS, input.energyCurve);
  const discontinuity =
    energyAtStart === null || energyBefore === null ? 0 : Math.abs(energyAtStart - energyBefore);
  const smoothness = 1 - clamp01(discontinuity);

  return clamp01(0.7 * alignment + 0.3 * smoothness);
}

/** 1 exactly on a structural time, falling linearly to 0 at the tolerance. */
function alignmentAt(timeMs: number, structural: readonly number[]): number {
  if (structural.length === 0) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const time of structural) {
    const distance = Math.abs(time - timeMs);
    if (distance < nearest) nearest = distance;
  }
  if (nearest >= STRUCTURAL_ALIGNMENT_TOLERANCE_MS) return 0;
  return 1 - nearest / STRUCTURAL_ALIGNMENT_TOLERANCE_MS;
}

function collectStructuralTimes(
  sections: readonly AudioSection[],
  downbeats: readonly number[],
): number[] {
  const times = new Set<number>();
  for (const section of sections) {
    times.add(section.startMs);
    times.add(section.endMs);
  }
  for (const downbeat of downbeats) times.add(downbeat);
  return [...times];
}

function energyAt(timeMs: number, energyCurve: readonly EnergyPoint[]): number | null {
  if (energyCurve.length === 0) return null;
  let best = energyCurve[0];
  if (!best) return null;
  let bestDistance = Math.abs(best.timeMs - timeMs);
  for (const point of energyCurve) {
    const distance = Math.abs(point.timeMs - timeMs);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best.value;
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
