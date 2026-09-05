import {
  DIRECTOR_PROMPT_VERSION,
  MOMENTS_PROMPT_VERSION,
  NARRATIVE_PROMPT_VERSION,
  SUBTITLES_PROMPT_VERSION,
  VISION_PROMPT_VERSION,
} from '@memetize/prompts';
import { sha256Hex } from '@memetize/shared';
import { CLIP_STYLES, TRANSITION_STYLES } from '@memetize/timeline';
import type {
  AudioSectionRef,
  DirectTimelineInput,
  DirectTimelineResult,
  EmbeddingProvider,
  EmbedResult,
  EnergyPointRef,
  FixtureDirectorStyles,
  FixtureLLMOptions,
  LLMProvider,
  LyricLineRef,
  MomentSuggestInput,
  MomentSuggestResult,
  NarrativeAnalyzeInput,
  NarrativeAnalyzeResult,
  NarrativeSegmentSuggestion,
  TranslateLyricsInput,
  TranslateLyricsResult,
  VisionAnalyzeInput,
  VisionAnalyzeResult,
  VisionProvider,
} from './types';

const FIXTURE_NAME = 'fixture';
const FIXTURE_VERSION = '1.0.0';

/**
 * Deterministic vision provider used by default and in tests (spec section
 * 66): no GPU or API call, but the output still respects the structured
 * schema (spec section 19) so downstream persistence and moment extraction
 * are exercised end-to-end without external dependencies.
 */
export class FixtureVisionProvider implements VisionProvider {
  readonly name = FIXTURE_NAME;

  async analyze(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    const hasSpeech = input.transcript.length > 0;
    const result = {
      summary: `Scene with ${input.frames.length} sampled frame(s)${hasSpeech ? ' and speech' : ''}.`,
      subjects: [],
      actions: hasSpeech ? ['speaking'] : [],
      emotionTrajectory: [],
      visualEnergy: 0.5,
      camera: { movement: 'static', shotType: 'unknown' },
      memeFunctions: ['unclassified'],
      quality: { usable: true, score: 0.5 },
    };
    return {
      result,
      model: FIXTURE_NAME,
      modelVersion: FIXTURE_VERSION,
      promptVersion: VISION_PROMPT_VERSION,
      raw: result,
    };
  }
}

/**
 * Deterministic moment suggester: one moment per scene, spanning its full
 * bounds. The MVP extractor must not block on perfect boundaries (spec
 * section 22); refinement (optical flow, face changes, ...) comes later.
 */
export class FixtureLLMProvider implements LLMProvider {
  readonly name = FIXTURE_NAME;
  readonly directorStyles: FixtureDirectorStyles;

  constructor(options: FixtureLLMOptions = {}) {
    this.directorStyles = options.directorStyles ?? 'plain';
  }

  async suggestMoments(input: MomentSuggestInput): Promise<MomentSuggestResult> {
    const [firstEmotion] = input.vision.emotionTrajectory;
    return {
      moments: [
        {
          startMs: input.startMs,
          endMs: input.endMs,
          description: input.vision.summary,
          primaryEmotion: firstEmotion?.emotion ?? null,
          emotionIntensity: firstEmotion?.intensity ?? null,
          visualEnergy: input.vision.visualEnergy,
          qualityScore: input.vision.quality.score,
          metadata: { memeFunctions: input.vision.memeFunctions },
        },
      ],
      extractor: FIXTURE_NAME,
      extractorVersion: FIXTURE_VERSION,
      promptVersion: MOMENTS_PROMPT_VERSION,
    };
  }

  /**
   * Deterministic narrative reading (spec section 27): one segment per lyric
   * line when there are lyrics, otherwise one segment per musical section
   * (instrumental tracks still get a narrative timeline). `energy` is looked
   * up from the nearest point on the audio analyzer's energy curve.
   */
  async analyzeNarrative(input: NarrativeAnalyzeInput): Promise<NarrativeAnalyzeResult> {
    const lyrics = input.lyrics
      .map((line) => clampRange(line, input.sourceStartMs, input.sourceEndMs))
      .filter((line): line is LyricLineRef => line !== null);
    const sections = input.sections
      .map((section) => clampRange(section, input.sourceStartMs, input.sourceEndMs))
      .filter((section): section is AudioSectionRef => section !== null);
    const energyCurve = input.energyCurve.filter(
      (point) => point.timeMs >= input.sourceStartMs && point.timeMs <= input.sourceEndMs,
    );

    const segments: NarrativeSegmentSuggestion[] =
      lyrics.length > 0
        ? lyrics.map((line, index) =>
            fixtureSegmentFromLyric(line, index, lyrics.length, energyCurve),
          )
        : sections.map((section) => fixtureSegmentFromSection(section, energyCurve));

    return {
      segments,
      extractor: FIXTURE_NAME,
      extractorVersion: FIXTURE_VERSION,
      promptVersion: NARRATIVE_PROMPT_VERSION,
    };
  }

  /**
   * Greedy, not "creative" (spec section 31 decision): for every segment
   * that has a shortlist, pick its first entry — already the top pick after
   * ranking and diversification (spec sections 29-30). Segments with an
   * empty shortlist get no pick, which the worker treats as valid, not a
   * failure.
   */
  async directTimeline(input: DirectTimelineInput): Promise<DirectTimelineResult> {
    const eligible = input.segments.filter((segment) => segment.shortlist.length > 0);
    const picks = eligible.map((segment, index) => {
      const top = segment.shortlist[0];
      if (!top) throw new Error('unreachable: filtered for non-empty shortlist');
      const styles =
        this.directorStyles === 'styled'
          ? styledCutStyles(index, index === eligible.length - 1)
          : { clipStyle: 'none' as const, transitionOut: 'hard' as const };
      return { segmentId: segment.id, momentId: top.momentId, ...styles };
    });

    return {
      picks,
      director: FIXTURE_NAME,
      directorVersion: FIXTURE_VERSION,
      promptVersion: DIRECTOR_PROMPT_VERSION,
    };
  }

  /**
   * Passthrough (translated-subtitles spec): fixture never calls a model, so
   * the original lines are shown and `translated` stays false.
   */
  async translateLyrics(input: TranslateLyricsInput): Promise<TranslateLyricsResult> {
    return {
      lines: [...input.lines],
      sourceLanguage: 'und',
      translated: false,
      model: FIXTURE_NAME,
      modelVersion: FIXTURE_VERSION,
      promptVersion: SUBTITLES_PROMPT_VERSION,
    };
  }
}

/**
 * `styled` fixture mode walks both vocabularies by segment position so a
 * six-segment fixture covers every transition and clip style once. The
 * last segment always cuts `hard`: there is nothing after it.
 */
function styledCutStyles(index: number, isLast: boolean) {
  const transitionOut = isLast
    ? 'hard'
    : (TRANSITION_STYLES[index % TRANSITION_STYLES.length] ?? 'hard');
  const clipStyle = CLIP_STYLES[index % CLIP_STYLES.length] ?? 'none';
  return { clipStyle, transitionOut };
}

function clampRange<T extends { startMs: number; endMs: number }>(
  range: T,
  windowStartMs: number,
  windowEndMs: number,
): T | null {
  const startMs = Math.max(range.startMs, windowStartMs);
  const endMs = Math.min(range.endMs, windowEndMs);
  if (startMs >= endMs) return null;
  return { ...range, startMs, endMs };
}

/** Nearest energy-curve value to `timeMs`, or a neutral default when the curve is empty. */
function nearestEnergy(timeMs: number, energyCurve: EnergyPointRef[]): number {
  if (energyCurve.length === 0) return 0.5;
  let best = energyCurve[0];
  let bestDiff = Math.abs((best?.timeMs ?? 0) - timeMs);
  for (const point of energyCurve) {
    const diff = Math.abs(point.timeMs - timeMs);
    if (diff < bestDiff) {
      best = point;
      bestDiff = diff;
    }
  }
  return best?.value ?? 0.5;
}

function fixtureSegmentFromLyric(
  line: LyricLineRef,
  index: number,
  total: number,
  energyCurve: EnergyPointRef[],
): NarrativeSegmentSuggestion {
  const narrativeFunction = index === 0 ? 'setup' : index === total - 1 ? 'payoff' : 'escalation';
  const visualIdeas = line.text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word.toLowerCase());
  return {
    startMs: line.startMs,
    endMs: line.endMs,
    lyrics: line.text,
    meaning: `literal reading of "${line.text}"`,
    emotion: 'neutral',
    narrativeFunction,
    visualIdeas: visualIdeas.length > 0 ? visualIdeas : ['reaction'],
    literalness: 0.5,
    ironyPotential: 0.5,
    energy: nearestEnergy(line.startMs, energyCurve),
  };
}

function fixtureSegmentFromSection(
  section: { type: string; startMs: number; endMs: number },
  energyCurve: EnergyPointRef[],
): NarrativeSegmentSuggestion {
  return {
    startMs: section.startMs,
    endMs: section.endMs,
    lyrics: '',
    meaning: `instrumental ${section.type} of the track`,
    emotion: 'neutral',
    narrativeFunction: section.type,
    visualIdeas: [section.type],
    literalness: 0.5,
    ironyPotential: 0.3,
    energy: nearestEnergy(section.startMs, energyCurve),
  };
}

/**
 * Deterministic embedding provider used by default and in tests (spec
 * section 66): no GPU or API call, but the same text always maps to the same
 * vector, so `search` results are stable across runs and worth asserting on
 * in the e2e suite.
 */
export class FixtureEmbeddingProvider implements EmbeddingProvider {
  readonly name = FIXTURE_NAME;

  constructor(readonly dimensions: number) {}

  async embed(texts: string[]): Promise<EmbedResult> {
    return {
      vectors: texts.map((text) => hashToUnitVector(text, this.dimensions)),
      model: FIXTURE_NAME,
      modelVersion: FIXTURE_VERSION,
    };
  }
}

/** Deterministically expands `text` into `dimensions` values in [-1, 1] by
 * chaining SHA-256 digests (32 bytes each) until enough bytes are produced. */
function hashToUnitVector(text: string, dimensions: number): number[] {
  const vector: number[] = [];
  let seed = text;
  while (vector.length < dimensions) {
    const digestHex = sha256Hex(seed);
    for (let i = 0; i < digestHex.length && vector.length < dimensions; i += 2) {
      const byte = Number.parseInt(digestHex.slice(i, i + 2), 16);
      vector.push((byte / 255) * 2 - 1);
    }
    seed = digestHex;
  }
  return vector;
}
