import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioAnalyzeInput, AudioAnalyzeOutput, WorkerResult } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import type { JobHandler } from '@memetize/orchestrator';
import { audioDebugFile, maybeEnqueueNarrative, replaceAudioAnalysis } from '@memetize/projects';
import { ensureDir, runPythonWorker } from '@memetize/shared';

/** Python project root (this file lives at workers/audio-analyzer/src/handler.ts). */
export const AUDIO_ANALYZER_DIR = fileURLToPath(new URL('..', import.meta.url));

const TIMEOUT_MS = 60_000;

/**
 * AUDIO_ANALYZE handler: spawns the Python worker over the stdin/stdout
 * protocol, validates its output against the contract, persists integer-ms
 * beats/sections/energy, keeps a debug snapshot (spec section 64), then
 * checks the AUDIO_ANALYZE + LYRICS barrier for NARRATIVE. Does not
 * interpret meaning and never calls an LLM (spec section 25).
 */
export function createAudioAnalyzeHandler(): JobHandler {
  return async (ctx) => {
    const parsed = AudioAnalyzeInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId, durationMs } = parsed.data;
    const provider = ctx.config.providers.audio.kind;

    let stdout: string;
    try {
      ({ stdout } = await runPythonWorker({
        cwd: AUDIO_ANALYZER_DIR,
        module: 'audio_analyzer',
        request: {
          jobId: ctx.job.id,
          entityId: projectId,
          workerVersion: ctx.job.workerVersion,
          input: { projectId, durationMs, provider },
        },
        timeoutMs: TIMEOUT_MS,
      }));
    } catch (error) {
      throw new JobFailure(
        'AUDIO_ANALYZE_SPAWN_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(stdout);
    } catch (error) {
      throw new JobFailure(
        'AUDIO_ANALYZE_BAD_OUTPUT',
        `stdout was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }

    const resultParse = WorkerResult.safeParse(raw);
    if (!resultParse.success) {
      throw new JobFailure('AUDIO_ANALYZE_BAD_OUTPUT', resultParse.error.message, false);
    }
    const result = resultParse.data;
    if (result.status === 'failed') {
      throw new JobFailure(result.error.code, result.error.message, result.error.retryable);
    }

    const outputParse = AudioAnalyzeOutput.safeParse(result.output);
    if (!outputParse.success) {
      throw new JobFailure('AUDIO_ANALYZE_BAD_OUTPUT', outputParse.error.message, false);
    }
    const output = outputParse.data;

    const persisted = await replaceAudioAnalysis(ctx.db, {
      projectId,
      durationMs: output.durationMs,
      bpm: output.bpm,
      beats: output.beats,
      downbeats: output.downbeats,
      sections: output.sections,
      energyCurve: output.energyCurve,
      analyzer: output.analyzer,
      analyzerVersion: output.analyzerVersion,
    });

    const debugFile = audioDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(debugFile.absolute, JSON.stringify(output, null, 2));

    await maybeEnqueueNarrative(ctx.db, projectId, 'AUDIO_ANALYZE');

    ctx.logger.info('audio_analyze_completed', {
      durationMs,
      beatCount: output.beats.length,
      sectionCount: output.sections.length,
    });
    return {
      analyzer: output.analyzer,
      analyzerVersion: output.analyzerVersion,
      beatCount: persisted.beats.length,
      sectionCount: persisted.sections.length,
    };
  };
}
