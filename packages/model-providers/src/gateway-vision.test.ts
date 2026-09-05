import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateObject } from 'ai';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayVisionProvider } from './gateway-vision';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  gateway: { textEmbeddingModel: (id: string) => ({ id }) },
}));

const generateObjectMock = vi.mocked(generateObject);

const analysis = {
  summary: 'a cat looks at the camera',
  subjects: [{ type: 'animal', description: 'cat' }],
  actions: ['stares'],
  emotionTrajectory: [],
  visualEnergy: 0.3,
  camera: { movement: 'static', shotType: 'close-up' },
  memeFunctions: ['reaction'],
  quality: { usable: true, score: 0.8 },
};

describe('GatewayVisionProvider (F01)', () => {
  let dir: string;

  beforeEach(async () => {
    generateObjectMock.mockReset();
    dir = await mkdtemp(join(tmpdir(), 'memetize-vision-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads frames from the absolute paths it is given and sends them as images', async () => {
    const framePath = join(dir, 'frame_000100.jpg');
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await writeFile(framePath, bytes);
    generateObjectMock.mockResolvedValue({ object: analysis } as never);

    const provider = new GatewayVisionProvider('anthropic/claude-sonnet-4.5');
    const result = await provider.analyze({
      sceneId: 'scn_1',
      startMs: 0,
      endMs: 1000,
      frames: [{ timestampMs: 100, path: framePath }],
      transcript: [{ startMs: 0, endMs: 500, text: 'hi' }],
    });

    const call = generateObjectMock.mock.calls[0]?.[0] as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const image = call.messages[0]?.content.find((part) => part.type === 'image');
    expect(Buffer.from(image?.image as Uint8Array)).toEqual(bytes);
    expect(image?.mediaType).toBe('image/jpeg');
    expect(result.model).toBe('anthropic/claude-sonnet-4.5');
    expect(result.modelVersion).toBe('1.0.0/anthropic/claude-sonnet-4.5');
  });

  it('fails loudly when a frame path does not resolve to a file', async () => {
    const provider = new GatewayVisionProvider('anthropic/claude-sonnet-4.5');
    await expect(
      provider.analyze({
        sceneId: 'scn_1',
        startMs: 0,
        endMs: 1000,
        frames: [{ timestampMs: 100, path: join(dir, 'missing.jpg') }],
        transcript: [],
      }),
    ).rejects.toThrow(/ENOENT/);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
