import { describe, expect, it } from 'vitest';
import { FixtureEmbeddingProvider, FixtureLLMProvider } from './fixture';

describe('FixtureEmbeddingProvider', () => {
  it('produces a vector of the configured dimension for each text', async () => {
    const provider = new FixtureEmbeddingProvider(384);
    const { vectors, model, modelVersion } = await provider.embed(['hello world', 'goodbye']);
    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      expect(vector).toHaveLength(384);
      for (const value of vector) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(model).toBe('fixture');
    expect(modelVersion).toBeTruthy();
  });

  it('is deterministic: the same text always maps to the same vector', async () => {
    const provider = new FixtureEmbeddingProvider(64);
    const [first] = (await provider.embed(['a person realizing something terrible happened']))
      .vectors;
    const [second] = (await provider.embed(['a person realizing something terrible happened']))
      .vectors;
    expect(first).toEqual(second);
  });

  it('maps different texts to different vectors', async () => {
    const provider = new FixtureEmbeddingProvider(64);
    const { vectors } = await provider.embed(['reaction shot', 'calm narration']);
    expect(vectors[0]).not.toEqual(vectors[1]);
  });

  it('respects a different configured dimension', async () => {
    const provider = new FixtureEmbeddingProvider(8);
    const { vectors } = await provider.embed(['short']);
    expect(vectors[0]).toHaveLength(8);
  });
});

describe('FixtureLLMProvider.analyzeNarrative', () => {
  const energyCurve = [
    { timeMs: 0, value: 0.2 },
    { timeMs: 1000, value: 0.8 },
  ];

  it('produces one segment per lyric line, marking the first setup and the last payoff', async () => {
    const provider = new FixtureLLMProvider();
    const result = await provider.analyzeNarrative({
      durationMs: 2000,
      sourceStartMs: 0,
      sourceEndMs: 2000,
      sections: [],
      energyCurve,
      lyrics: [
        { startMs: 0, endMs: 1000, text: 'I am the best' },
        { startMs: 1000, endMs: 2000, text: 'nobody can stop me' },
      ],
    });

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.narrativeFunction).toBe('setup');
    expect(result.segments[1]?.narrativeFunction).toBe('payoff');
    expect(result.segments[0]?.lyrics).toBe('I am the best');
    expect(result.segments[0]?.visualIdeas.length).toBeGreaterThan(0);
    expect(result.extractor).toBe('fixture');
    expect(result.promptVersion).toBeTruthy();
  });

  it('falls back to one segment per musical section for an instrumental track', async () => {
    const provider = new FixtureLLMProvider();
    const result = await provider.analyzeNarrative({
      durationMs: 4000,
      sourceStartMs: 0,
      sourceEndMs: 4000,
      sections: [
        { type: 'intro', startMs: 0, endMs: 2000 },
        { type: 'chorus', startMs: 2000, endMs: 4000 },
      ],
      energyCurve,
      lyrics: [],
    });

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.lyrics).toBe('');
    expect(result.segments[0]?.narrativeFunction).toBe('intro');
    expect(result.segments[1]?.narrativeFunction).toBe('chorus');
  });

  it('is deterministic for the same input', async () => {
    const provider = new FixtureLLMProvider();
    const input = {
      durationMs: 1000,
      sourceStartMs: 0,
      sourceEndMs: 1000,
      sections: [],
      energyCurve,
      lyrics: [{ startMs: 0, endMs: 1000, text: 'same line' }],
    };
    const first = await provider.analyzeNarrative(input);
    const second = await provider.analyzeNarrative(input);
    expect(first).toEqual(second);
  });

  it('picks the nearest energy-curve value for each segment', async () => {
    const provider = new FixtureLLMProvider();
    const result = await provider.analyzeNarrative({
      durationMs: 2000,
      sourceStartMs: 0,
      sourceEndMs: 2000,
      sections: [],
      energyCurve,
      lyrics: [{ startMs: 900, endMs: 1000, text: 'near the second point' }],
    });
    expect(result.segments[0]?.energy).toBe(0.8);
  });

  it('keeps suggestions inside the selected source window', async () => {
    const provider = new FixtureLLMProvider();
    const result = await provider.analyzeNarrative({
      durationMs: 120_000,
      sourceStartMs: 60_000,
      sourceEndMs: 120_000,
      sections: [{ type: 'chorus', startMs: 60_000, endMs: 120_000 }],
      energyCurve: [{ timeMs: 60_000, value: 0.9 }],
      lyrics: [{ startMs: 61_000, endMs: 63_000, text: 'hook' }],
    });
    expect(result.segments).toEqual([
      expect.objectContaining({ startMs: 61_000, endMs: 63_000, lyrics: 'hook' }),
    ]);
  });
});

describe('FixtureLLMProvider.directTimeline', () => {
  function segment(id: string, shortlist: { momentId: string; finalScore: number }[]) {
    return {
      id,
      startMs: 0,
      endMs: 1000,
      meaning: 'meaning',
      emotion: 'neutral',
      narrativeFunction: 'setup',
      lyrics: '',
      energy: 0.5,
      shortlist: shortlist.map((entry) => ({
        assetId: `ast_${entry.momentId}`,
        description: 'a moment',
        durationMs: 1000,
        primaryEmotion: null,
        ...entry,
      })),
    };
  }

  it('picks the top (first) shortlist entry for every segment that has one', async () => {
    const provider = new FixtureLLMProvider();
    const result = await provider.directTimeline({
      durationMs: 2000,
      sections: [],
      segments: [
        segment('nar_1', [
          { momentId: 'mom_a', finalScore: 0.9 },
          { momentId: 'mom_b', finalScore: 0.8 },
        ]),
        segment('nar_2', [{ momentId: 'mom_c', finalScore: 0.7 }]),
      ],
    });

    expect(result.picks).toEqual([
      { segmentId: 'nar_1', momentId: 'mom_a', clipStyle: 'none', transitionOut: 'hard' },
      { segmentId: 'nar_2', momentId: 'mom_c', clipStyle: 'none', transitionOut: 'hard' },
    ]);
    expect(result.director).toBe('fixture');
    expect(result.promptVersion).toBeTruthy();
  });

  it('skips segments with an empty shortlist instead of failing', async () => {
    const provider = new FixtureLLMProvider();
    const result = await provider.directTimeline({
      durationMs: 1000,
      sections: [],
      segments: [segment('nar_1', []), segment('nar_2', [{ momentId: 'mom_a', finalScore: 0.5 }])],
    });

    expect(result.picks).toEqual([
      { segmentId: 'nar_2', momentId: 'mom_a', clipStyle: 'none', transitionOut: 'hard' },
    ]);
  });

  it('assigns fixed cut styles by segment position in styled mode', async () => {
    const provider = new FixtureLLMProvider({ directorStyles: 'styled' });
    const segments = ['nar_1', 'nar_2', 'nar_3', 'nar_4', 'nar_5', 'nar_6'].map((id, index) =>
      segment(id, [{ momentId: `mom_${index}`, finalScore: 0.5 }]),
    );
    const result = await provider.directTimeline({ durationMs: 6000, sections: [], segments });

    expect(result.picks.map((pick) => pick.transitionOut)).toEqual([
      'hard',
      'dip_black',
      'flash',
      'crossfade',
      'whip',
      'hard',
    ]);
    expect(result.picks.map((pick) => pick.clipStyle)).toEqual([
      'none',
      'hold',
      'speed_up',
      'slow_down',
      'none',
      'hold',
    ]);

    const again = await provider.directTimeline({ durationMs: 6000, sections: [], segments });
    expect(again).toEqual(result);
  });

  it('is deterministic for the same input', async () => {
    const provider = new FixtureLLMProvider();
    const input = {
      durationMs: 1000,
      sections: [],
      segments: [segment('nar_1', [{ momentId: 'mom_a', finalScore: 0.5 }])],
    };
    const first = await provider.directTimeline(input);
    const second = await provider.directTimeline(input);
    expect(first).toEqual(second);
  });
});
