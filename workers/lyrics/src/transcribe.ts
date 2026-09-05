import { TranscriptOutput } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { decodePythonResponse, type PythonRunResult, runPythonWorker } from '@memetize/shared';
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
  let run: PythonRunResult;
  try {
    run = await runPythonWorker({
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
    });
  } catch (error) {
    throw new JobFailure(
      'LYRICS_TRANSCRIBE_ERROR',
      error instanceof Error ? error.message : String(error),
      false,
    );
  }

  let result: ReturnType<typeof decodePythonResponse>;
  try {
    result = decodePythonResponse(run, args.jobId);
  } catch (error) {
    throw new JobFailure(
      'LYRICS_TRANSCRIBE_ERROR',
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
    throw new JobFailure('LYRICS_TRANSCRIBE_ERROR', outputParse.error.message, false);
  }
  return outputParse.data;
}
