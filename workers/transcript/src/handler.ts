import { fileURLToPath } from 'node:url';
import { TranscriptInput, TranscriptOutput, WorkerResult } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { assetFile, replaceTranscript, resolveStorage } from '@memetize/media-catalog';
import type { JobHandler } from '@memetize/orchestrator';
import { runPythonWorker } from '@memetize/shared';
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

    let stdout: string;
    try {
      ({ stdout } = await runPythonWorker({
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
      }));
    } catch (error) {
      throw new JobFailure(
        'TRANSCRIPT_SPAWN_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(stdout);
    } catch (error) {
      throw new JobFailure(
        'TRANSCRIPT_BAD_OUTPUT',
        `stdout was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }

    const resultParse = WorkerResult.safeParse(raw);
    if (!resultParse.success) {
      throw new JobFailure('TRANSCRIPT_BAD_OUTPUT', resultParse.error.message, false);
    }
    const result = resultParse.data;
    if (result.status === 'failed') {
      throw new JobFailure(result.error.code, result.error.message, result.error.retryable);
    }

    const outputParse = TranscriptOutput.safeParse(result.output);
    if (!outputParse.success) {
      throw new JobFailure('TRANSCRIPT_BAD_OUTPUT', outputParse.error.message, false);
    }
    const output = outputParse.data;

    const persisted = await replaceTranscript(ctx.db, {
      assetId,
      model: output.model,
      modelVersion: output.modelVersion,
      segments: output.segments,
    });

    // VISION_ANALYZE fan-in is enqueued from the orchestrator's post-completion hook (F10).

    ctx.logger.info('transcript_persisted', { segmentCount: persisted.length });
    return {
      segmentCount: persisted.length,
      model: output.model,
      modelVersion: output.modelVersion,
    };
  };
}
