import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { VisionSceneAnalysis } from '@memetize/contracts';
import { VISION_PROMPT_V1, VISION_PROMPT_VERSION } from '@memetize/prompts';
import { generateObject } from 'ai';
import type { VisionAnalyzeInput, VisionAnalyzeResult, VisionProvider } from './types';

const GATEWAY_NAME = 'gateway';
const GATEWAY_VERSION = '1.0.0';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Real vision provider routed through the Vercel AI Gateway (F01). It sends the
 * scene's sampled frames as images plus its transcript to a multimodal model and
 * parses the reply against the `VisionSceneAnalysis` contract, so an invalid
 * shape fails the structured-output parse rather than reaching the catalog.
 * Provenance (model, version, prompt) is returned with the result.
 */
export class GatewayVisionProvider implements VisionProvider {
  readonly name = GATEWAY_NAME;

  constructor(private readonly model: string) {}

  async analyze(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    const images = await Promise.all(
      input.frames.map(async (frame) => ({
        type: 'image' as const,
        image: await readFile(frame.path),
        mediaType: MIME_BY_EXT[extname(frame.path).toLowerCase()] ?? 'image/jpeg',
      })),
    );
    const transcriptText = input.transcript
      .map((line) => line.text)
      .join(' ')
      .trim();

    const { object } = await generateObject({
      model: this.model,
      schema: VisionSceneAnalysis,
      system: VISION_PROMPT_V1,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sceneId: input.sceneId,
                startMs: input.startMs,
                endMs: input.endMs,
                frameCount: input.frames.length,
                transcript: transcriptText,
              }),
            },
            ...images,
          ],
        },
      ],
    });

    // Re-parse so contract defaults apply even when the SDK returns the raw object.
    const result = VisionSceneAnalysis.parse(object);
    return {
      result,
      model: this.model,
      modelVersion: GATEWAY_VERSION,
      promptVersion: VISION_PROMPT_VERSION,
      raw: object,
    };
  }
}
