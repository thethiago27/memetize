import { MomentCandidate, MomentExtractInput } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { listScenes, listTranscriptSegments, replaceMoments } from '@memetize/media-catalog';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';

function overlaps(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * MOMENT_EXTRACT handler (spec sections 21-22): asks the configured
 * `LLMProvider` to split each scene into editorial moments. The MVP does not
 * block on perfect boundaries, but every suggested moment must still fall
 * within its scene's bounds.
 */
export function createMomentExtractHandler(): JobHandler {
  return async (ctx) => {
    const parsed = MomentExtractInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { assetId } = parsed.data;

    const scenes = await listScenes(ctx.db, assetId);
    const transcript = await listTranscriptSegments(ctx.db, assetId);
    const { llm } = createProviders(ctx.config);

    const candidates: MomentCandidate[] = [];
    let extractor = llm.name;
    let extractorVersion = '';

    try {
      for (const scene of scenes) {
        if (!scene.vision) {
          throw new Error(`scene ${scene.id} has no vision analysis yet`);
        }
        const sceneTranscript = transcript
          .filter((segment) => overlaps(scene, segment))
          .map((segment) => ({
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
          }));

        const suggestion = await llm.suggestMoments({
          sceneId: scene.id,
          startMs: scene.startMs,
          endMs: scene.endMs,
          vision: scene.vision,
          transcript: sceneTranscript,
        });
        extractor = suggestion.extractor;
        extractorVersion = suggestion.extractorVersion;

        for (const moment of suggestion.moments) {
          if (moment.startMs < scene.startMs || moment.endMs > scene.endMs) {
            throw new Error(
              `moment [${moment.startMs}, ${moment.endMs}] falls outside scene ${scene.id} bounds [${scene.startMs}, ${scene.endMs}]`,
            );
          }
          candidates.push(MomentCandidate.parse({ ...moment, sceneId: scene.id }));
        }
      }
    } catch (error) {
      throw new JobFailure(
        'MOMENT_EXTRACT_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    const persisted = await replaceMoments(ctx.db, {
      assetId,
      extractor,
      extractorVersion,
      moments: candidates,
    });

    ctx.logger.info('moment_extract_completed', {
      momentCount: persisted.length,
      extractor,
      extractorVersion,
    });
    return { momentCount: persisted.length, extractor, extractorVersion };
  };
}
