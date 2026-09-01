import type { AudioSection, EnergyPoint, NarrativeSegment } from '@memetize/contracts';
import { MAX_VISUAL_SLOT_MS, MIN_VISUAL_SLOT_MS } from './constants';

export interface NarrativeCoverageInput {
  window: { sourceStartMs: number; sourceEndMs: number };
  suggestions: readonly CoverageSuggestion[];
  sections: readonly AudioSection[];
  beats: readonly number[];
  energyCurve: readonly EnergyPoint[];
}

export type CoverageSuggestion = Omit<NarrativeSegment, 'sourceKind'>;

interface Span extends NarrativeSegment {}

export function planNarrativeCoverage(input: NarrativeCoverageInput): NarrativeSegment[] {
  const { sourceStartMs, sourceEndMs } = input.window;
  const windowMs = sourceEndMs - sourceStartMs;
  if (windowMs <= 0) return [];

  if (windowMs < MIN_VISUAL_SLOT_MS) {
    const suggestion = clampSuggestion(input.suggestions[0], sourceStartMs, sourceEndMs);
    if (suggestion) {
      return [{ ...toLyricSpan(suggestion), startMs: sourceStartMs, endMs: sourceEndMs }];
    }
    return [instrumentalSpan(sourceStartMs, sourceEndMs, input)];
  }

  const clamped = input.suggestions
    .map((suggestion) => clampSuggestion(suggestion, sourceStartMs, sourceEndMs))
    .filter((suggestion): suggestion is CoverageSuggestion => suggestion !== null)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const trimmed: CoverageSuggestion[] = [];
  for (const suggestion of clamped) {
    const previous = trimmed.at(-1);
    const startMs = previous ? Math.max(suggestion.startMs, previous.endMs) : suggestion.startMs;
    if (startMs >= suggestion.endMs) continue;
    trimmed.push({ ...suggestion, startMs });
  }

  const filled: Span[] = [];
  let cursor = sourceStartMs;
  for (const suggestion of trimmed) {
    if (suggestion.startMs > cursor) {
      filled.push(instrumentalSpan(cursor, suggestion.startMs, input));
    }
    filled.push(toLyricSpan(suggestion));
    cursor = suggestion.endMs;
  }
  if (cursor < sourceEndMs) {
    filled.push(instrumentalSpan(cursor, sourceEndMs, input));
  }

  return filled.flatMap((span) => splitSpan(span, input.beats));
}

function clampSuggestion(
  suggestion: CoverageSuggestion | undefined,
  windowStartMs: number,
  windowEndMs: number,
): CoverageSuggestion | null {
  if (!suggestion) return null;
  const startMs = Math.max(suggestion.startMs, windowStartMs);
  const endMs = Math.min(suggestion.endMs, windowEndMs);
  if (startMs >= endMs) return null;
  return { ...suggestion, startMs, endMs };
}

function toLyricSpan(suggestion: CoverageSuggestion): Span {
  return { ...suggestion, sourceKind: 'LYRIC' };
}

function instrumentalSpan(startMs: number, endMs: number, input: NarrativeCoverageInput): Span {
  const section = containingSection(startMs, endMs, input.sections);
  const type = section?.type ?? 'instrumental';
  return {
    sourceKind: 'INSTRUMENTAL',
    startMs,
    endMs,
    lyrics: '',
    meaning: `instrumental ${type}`,
    emotion: 'neutral',
    narrativeFunction: type,
    visualIdeas: [type, 'instrumental'],
    literalness: 0.5,
    ironyPotential: 0.5,
    energy: nearestEnergy(startMs, input.energyCurve),
  };
}

function splitSpan(span: Span, beats: readonly number[]): Span[] {
  const durationMs = span.endMs - span.startMs;
  if (durationMs <= MAX_VISUAL_SLOT_MS) return [span];

  const pieces: Span[] = [];
  let cursor = span.startMs;
  while (span.endMs - cursor > MAX_VISUAL_SLOT_MS) {
    const ideal = cursor + MAX_VISUAL_SLOT_MS;
    const cut = pickSplitBeat(beats, cursor, span.endMs, ideal);
    if (cut === null || span.endMs - cut < MIN_VISUAL_SLOT_MS) break;
    pieces.push({ ...span, startMs: cursor, endMs: cut });
    cursor = cut;
  }

  const remainder = span.endMs - cursor;
  if (remainder > 0) {
    if (remainder < MIN_VISUAL_SLOT_MS && pieces.length > 0) {
      const previous = pieces[pieces.length - 1];
      if (previous) previous.endMs = span.endMs;
    } else {
      pieces.push({ ...span, startMs: cursor, endMs: span.endMs });
    }
  }
  return pieces.length > 0 ? pieces : [span];
}

function pickSplitBeat(
  beats: readonly number[],
  startMs: number,
  endMs: number,
  idealMs: number,
): number | null {
  const interior = beats.filter(
    (beat) => beat > startMs && beat < endMs && beat - startMs >= MIN_VISUAL_SLOT_MS,
  );
  if (interior.length === 0) return idealMs < endMs ? idealMs : null;

  let best = interior[0];
  if (best === undefined) return idealMs < endMs ? idealMs : null;
  let bestDistance = Math.abs(best - idealMs);
  for (const beat of interior) {
    const distance = Math.abs(beat - idealMs);
    if (distance < bestDistance || (distance === bestDistance && beat < best)) {
      best = beat;
      bestDistance = distance;
    }
  }
  return best;
}

function containingSection(
  startMs: number,
  endMs: number,
  sections: readonly AudioSection[],
): AudioSection | undefined {
  const containing = sections.find(
    (section) => section.startMs <= startMs && section.endMs >= endMs,
  );
  if (containing) return containing;
  return sections.find((section) => section.startMs <= startMs && startMs < section.endMs);
}

function nearestEnergy(timeMs: number, energyCurve: readonly EnergyPoint[]): number {
  if (energyCurve.length === 0) return 0.5;
  let best = energyCurve[0];
  if (!best) return 0.5;
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
