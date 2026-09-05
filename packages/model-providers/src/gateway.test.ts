import { DIRECTOR_PROMPT_V4, DIRECTOR_PROMPT_VERSION } from '@memetize/prompts';
import { generateObject } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectorPicksSchema, GatewayLLMProvider } from './gateway';
import type { DirectTimelineInput } from './types';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

const generateObjectMock = vi.mocked(generateObject);

function directorInput(): DirectTimelineInput {
  return {
    durationMs: 2000,
    sections: [{ type: 'chorus', startMs: 0, endMs: 2000 }],
    segments: [
      {
        id: 'nar_1',
        startMs: 0,
        endMs: 1000,
        meaning: 'setup beat',
        emotion: 'neutral',
        narrativeFunction: 'setup',
        lyrics: 'hello',
        energy: 0.5,
        shortlist: [
          {
            momentId: 'mom_a',
            assetId: 'ast_1',
            finalScore: 0.9,
            description: 'a moment',
            durationMs: 800,
            primaryEmotion: null,
          },
        ],
      },
    ],
  };
}

describe('GatewayLLMProvider.directTimeline', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it('calls generateObject with the Director system prompt and returns mocked picks', async () => {
    const picks = [{ segmentId: 'nar_1', momentId: 'mom_a' }];
    generateObjectMock.mockResolvedValue({ object: { picks } } as never);

    const memory = {
      lessons: ['Editor note: shorter cuts on the drop'],
      examples: [
        {
          narrativeFunction: 'payoff',
          emotion: 'joy',
          meaning: 'release',
          lyrics: 'la',
          chosenMomentId: 'mom_b',
          chosenDescription: 'cat stares',
        },
      ],
    };
    const input = { ...directorInput(), memory };
    const provider = new GatewayLLMProvider({ model: 'anthropic/claude-sonnet-4.5' });
    const result = await provider.directTimeline(input);

    expect(generateObjectMock).toHaveBeenCalledOnce();
    const call = generateObjectMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: 'anthropic/claude-sonnet-4.5',
      system: DIRECTOR_PROMPT_V4,
    });
    expect(call?.prompt).toBe(
      JSON.stringify({
        durationMs: input.durationMs,
        sections: input.sections,
        segments: input.segments,
        memory,
      }),
    );
    expect(result.picks).toEqual([
      { segmentId: 'nar_1', momentId: 'mom_a', clipStyle: 'none', transitionOut: 'hard' },
    ]);
    expect(result.director).toBe('gateway');
    expect(result.directorVersion).toBe('1.0.0/anthropic/claude-sonnet-4.5');
    expect(result.promptVersion).toBe(DIRECTOR_PROMPT_VERSION);
  });

  it('sends an empty memory when the caller offers none', async () => {
    generateObjectMock.mockResolvedValue({ object: { picks: [] } } as never);
    const provider = new GatewayLLMProvider({ model: 'anthropic/claude-sonnet-4.5' });
    await provider.directTimeline(directorInput());
    const call = generateObjectMock.mock.calls[0]?.[0];
    expect(JSON.parse(String(call?.prompt)).memory).toEqual({ lessons: [], examples: [] });
  });

  it('lets SDK errors propagate', async () => {
    generateObjectMock.mockRejectedValue(new Error('gateway timeout'));
    const provider = new GatewayLLMProvider({ model: 'anthropic/claude-sonnet-4.5' });
    await expect(provider.directTimeline(directorInput())).rejects.toThrow('gateway timeout');
  });
});

describe('DirectorPicksSchema', () => {
  it('defaults omitted cut styles and keeps explicit ones', () => {
    const parsed = DirectorPicksSchema.parse({
      picks: [
        { segmentId: 'nar_1', momentId: 'mom_a' },
        { segmentId: 'nar_2', momentId: 'mom_b', clipStyle: 'hold', transitionOut: 'flash' },
      ],
    });
    expect(parsed.picks[0]).toEqual({
      segmentId: 'nar_1',
      momentId: 'mom_a',
      clipStyle: 'none',
      transitionOut: 'hard',
    });
    expect(parsed.picks[1]).toMatchObject({ clipStyle: 'hold', transitionOut: 'flash' });
  });

  it('rejects a style outside the closed vocabulary', () => {
    expect(
      DirectorPicksSchema.safeParse({
        picks: [{ segmentId: 'nar_1', momentId: 'mom_a', transitionOut: 'glitch' }],
      }).success,
    ).toBe(false);
  });
});

describe('GatewayLLMProvider narrative and moments', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it('runs analyzeNarrative through the SDK with real provenance (F01)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            lyrics: 'a line',
            meaning: 'm',
            emotion: 'joy',
            narrativeFunction: 'setup',
            visualIdeas: [],
            literalness: 0.5,
            ironyPotential: 0.5,
            energy: 0.5,
          },
        ],
      },
    } as never);
    const provider = new GatewayLLMProvider({ model: 'anthropic/claude-sonnet-4.5' });
    const result = await provider.analyzeNarrative({
      durationMs: 1000,
      sourceStartMs: 0,
      sourceEndMs: 1000,
      sections: [],
      energyCurve: [],
      lyrics: [{ startMs: 0, endMs: 1000, text: 'a line' }],
    });
    expect(result.extractor).toBe('gateway');
    expect(result.segments).toHaveLength(1);
    expect(generateObjectMock).toHaveBeenCalledOnce();
  });

  it('runs suggestMoments through the SDK with real provenance (F01)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        moments: [{ startMs: 0, endMs: 1000, description: 'a moment', metadata: {} }],
      },
    } as never);
    const provider = new GatewayLLMProvider({ model: 'anthropic/claude-sonnet-4.5' });
    const result = await provider.suggestMoments({
      sceneId: 'scn_1',
      startMs: 0,
      endMs: 1000,
      vision: {
        summary: 'a scene',
        subjects: [],
        actions: [],
        emotionTrajectory: [],
        visualEnergy: 0.5,
        camera: { movement: 'static', shotType: 'unknown' },
        memeFunctions: [],
        quality: { usable: true, score: 0.5 },
      },
      transcript: [],
    });
    expect(result.extractor).toBe('gateway');
    expect(result.moments).toHaveLength(1);
    expect(generateObjectMock).toHaveBeenCalledOnce();
  });
});
