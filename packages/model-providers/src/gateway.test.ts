import { DIRECTOR_PROMPT_V1, DIRECTOR_PROMPT_VERSION } from '@memetize/prompts';
import { generateObject } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayLLMProvider } from './gateway';
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

    const input = directorInput();
    const provider = new GatewayLLMProvider({ model: 'anthropic/claude-sonnet-4.5' });
    const result = await provider.directTimeline(input);

    expect(generateObjectMock).toHaveBeenCalledOnce();
    const call = generateObjectMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: 'anthropic/claude-sonnet-4.5',
      system: DIRECTOR_PROMPT_V1,
    });
    expect(call?.prompt).toBe(
      JSON.stringify({
        durationMs: input.durationMs,
        sections: input.sections,
        segments: input.segments,
      }),
    );
    expect(result.picks).toEqual(picks);
    expect(result.director).toBe('gateway');
    expect(result.directorVersion).toBe('1.0.0');
    expect(result.promptVersion).toBe(DIRECTOR_PROMPT_VERSION);
  });

  it('lets SDK errors propagate', async () => {
    generateObjectMock.mockRejectedValue(new Error('gateway timeout'));
    const provider = new GatewayLLMProvider({ model: 'anthropic/claude-sonnet-4.5' });
    await expect(provider.directTimeline(directorInput())).rejects.toThrow('gateway timeout');
  });
});

describe('GatewayLLMProvider narrative and moments', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it('delegates analyzeNarrative to the fixture without calling the SDK', async () => {
    const provider = new GatewayLLMProvider({ model: 'anthropic/claude-sonnet-4.5' });
    const result = await provider.analyzeNarrative({
      durationMs: 1000,
      sourceStartMs: 0,
      sourceEndMs: 1000,
      sections: [],
      energyCurve: [],
      lyrics: [{ startMs: 0, endMs: 1000, text: 'a line' }],
    });
    expect(result.extractor).toBe('fixture');
    expect(result.segments).toHaveLength(1);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('delegates suggestMoments to the fixture without calling the SDK', async () => {
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
    expect(result.extractor).toBe('fixture');
    expect(result.moments).toHaveLength(1);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
