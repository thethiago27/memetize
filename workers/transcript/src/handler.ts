import { fileURLToPath } from 'node:url';
import { TranscriptInput, TranscriptOutput } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { assetFile, replaceTranscript, resolveStorage } from '@memetize/media-catalog';
import type { JobHandler } from '@memetize/orchestrator';
import { decodePythonResponse, type PythonRunResult, runPythonWorker } from '@memetize/shared';
import { extractAudio } from './audio';

/** Python project root (this file lives at workers/transcript/src/handler.ts). */
export const TRANSCRIPT_DIR = fileURLToPath(new URL('..', import.meta.url));

const TIMEOUT_MS = 120_000;

/**
 * TRANSCRIPT handler: extracts audio (if any), spawns the Python worker over
 * the stdin/stdout protocol, validates its output, persists integer-ms
 * segments, then signals the frames/transcript barrier.
 */
export function createTranscriptHandler(): JobHandler {
  return async (ctx) => {
    const parsed = TranscriptInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { assetId } = parsed.data;
    const originalAbsolute = resolveStorage(ctx.config, parsed.data.originalPath);
    const audioFile = assetFile(ctx.config, assetId, 'audio.wav');
    const audioPath = await extractAudio(originalAbsolute, audioFile.absolute);
    const provider = ctx.config.providers.transcription.kind;
    const useMlx = provider === 'mlx' || provider === 'mlx-whisper';

    let run: PythonRunResult;
    try {
      run = await runPythonWorker({
        cwd: TRANSCRIPT_DIR,
        module: 'transcript_worker',
        args: useMlx ? ['run', '--extra', 'mlx', 'python', '-m', 'transcript_worker'] : undefined,
        request: {
          jobId: ctx.job.id,
          entityId: assetId,
          workerVersion: ctx.job.workerVersion,
          input: {
            assetId,
            audioPath,
            provider,
            model: ctx.config.providers.transcription.model,
          },
        },
        timeoutMs: TIMEOUT_MS,
      });
    } catch (error) {
      throw new JobFailure(
        'TRANSCRIPT_SPAWN_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    let result: ReturnType<typeof decodePythonResponse>;
    try {
      result = decodePythonResponse(run, ctx.job.id);
    } catch (error) {
      throw new JobFailure(
        'TRANSCRIPT_BAD_OUTPUT',
        `${error instanceof Error ? error.message : String(error)}; stderr: ${run.stderr.trim().slice(0, 2000)}`,
        false,
      );
    }
    // A declared failure preserves the worker's code/message/retryability (F14).
    if (result.status === 'failed') {
      throw new JobFailure(result.error.code, result.error.message, result.error.retryable);
    }

    const outputParse = TranscriptOutput.safeParse(result.output);
    if (!outputParse.success) {
      throw new JobFailure('TRANSCRIPT_BAD_OUTPUT', outputParse.error.message, false);
    }
    const output = outputParse.data;

    // The segments commit together with the job completion, only while this
    // attempt still owns the lease and its generation is current (F08/F09).
    // VISION_ANALYZE fan-in is enqueued from the orchestrator's post-completion hook (F10).
    const published = await ctx.publish(async ({ tx }) => {
      const persisted = await replaceTranscript(tx, {
        assetId,
        model: output.model,
        modelVersion: output.modelVersion,
        segments: output.segments,
      });
      return {
        segmentCount: persisted.length,
        model: output.model,
        modelVersion: output.modelVersion,
      };
    });

    ctx.logger.info('transcript_persisted', { segmentCount: published.segmentCount });
    return published;
  };
}
