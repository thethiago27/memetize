import { TranscriptOutput, WorkerResult } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { runPythonWorker } from '@memetize/shared';
import { TRANSCRIPT_DIR } from '@memetize/transcript';

const TRANSCRIBE_TIMEOUT_MS = 900_000;

export function isMlxTranscriptionProvider(kind: string): boolean {
  return kind === 'mlx' || kind === 'mlx-whisper';
}

/**
 * Reuses the video transcript worker (spec section 17) to turn a project's
 * audio file into timed lyric lines (spec section 26's TRANSCRIPT source).
 * The lyrics worker never imports a model SDK — it only speaks the existing
 * stdin/stdout protocol.
 */
export async function transcribeProjectAudio(args: {
  jobId: string;
  projectId: string;
  audioPath: string;
  provider: string;
  model: string | null;
}): Promise<TranscriptOutput> {
  let stdout: string;
  try {
    ({ stdout } = await runPythonWorker({
      cwd: TRANSCRIPT_DIR,
      module: 'transcript_worker',
      args: ['run', '--extra', 'mlx', 'python', '-m', 'transcript_worker'],
      request: {
        jobId: args.jobId,
        entityId: args.projectId,
        workerVersion: '1.0.0',
          input: {
            assetId: args.projectId,
            audioPath: args.audioPath,
            provider: args.provider,
            model: args.model,
          },
      },
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    }));
  } catch (error) {
    throw new JobFailure(
      'LYRICS_TRANSCRIBE_ERROR',
      error instanceof Error ? error.message : String(error),
      false,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch (error) {
    throw new JobFailure(
      'LYRICS_TRANSCRIBE_ERROR',
      `stdout was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      false,
    );
  }

  const resultParse = WorkerResult.safeParse(raw);
  if (!resultParse.success) {
    throw new JobFailure('LYRICS_TRANSCRIBE_ERROR', resultParse.error.message, false);
  }
  const result = resultParse.data;
  if (result.status === 'failed') {
    throw new JobFailure(result.error.code, result.error.message, result.error.retryable);
  }

  const outputParse = TranscriptOutput.safeParse(result.output);
  if (!outputParse.success) {
    throw new JobFailure('LYRICS_TRANSCRIBE_ERROR', outputParse.error.message, false);
  }
  return outputParse.data;
}
