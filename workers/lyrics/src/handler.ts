import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { LyricsInput } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import type { JobHandler } from '@memetize/orchestrator';
import { audioFile, lyricsDebugFile, replaceLyrics, resolveStorage } from '@memetize/projects';
import { ensureDir } from '@memetize/shared';
import { formatLrc, parseLrc, parseTextLines, segmentsToLyricLines } from './parse';
import { isMlxTranscriptionProvider, transcribeProjectAudio } from './transcribe';

const FIXTURE_MODEL = 'fixture';
const LRC_PARSER = 'lrc-parser';
const TEXT_PARSER = 'text-splitter';
const PARSER_VERSION = '1.0.0';

/**
 * LYRICS handler (spec section 26): parses a user-supplied `.lrc`/`.txt`
 * file when given one; otherwise, if `TRANSCRIPTION_PROVIDER` is mlx,
 * transcribes the project's audio into timed lines; otherwise persists an
 * empty (instrumental) fixture — never a failure. Keeps a debug snapshot,
 * then checks the AUDIO_ANALYZE + LYRICS barrier for NARRATIVE.
 */
export function createLyricsHandler(): JobHandler {
  return async (ctx) => {
    const parsed = LyricsInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId, lyricsPath, originalPath, durationMs } = parsed.data;
    const transcriptionKind = ctx.config.providers.transcription.kind;

    let source: 'USER' | 'TRANSCRIPT' | 'FIXTURE' = 'FIXTURE';
    let lines: ReturnType<typeof parseLrc> = [];
    let model = FIXTURE_MODEL;
    let modelVersion = PARSER_VERSION;

    if (lyricsPath) {
      const absolute = resolveStorage(ctx.config, lyricsPath);
      let content: string;
      try {
        content = await readFile(absolute, 'utf8');
      } catch (error) {
        throw new JobFailure(
          'LYRICS_READ_ERROR',
          error instanceof Error ? error.message : String(error),
          false,
        );
      }

      source = 'USER';
      const ext = extname(lyricsPath).toLowerCase();
      if (ext === '.lrc') {
        lines = parseLrc(content, durationMs);
        model = LRC_PARSER;
      } else {
        lines = parseTextLines(content, durationMs);
        model = TEXT_PARSER;
      }
    } else if (isMlxTranscriptionProvider(transcriptionKind)) {
      if (!originalPath) {
        throw new JobFailure(
          'LYRICS_NO_AUDIO',
          `project ${projectId} has no originalPath to transcribe`,
          false,
        );
      }
      const transcript = await transcribeProjectAudio({
        jobId: ctx.job.id,
        projectId,
        audioPath: resolveStorage(ctx.config, originalPath),
        provider: transcriptionKind,
        model: ctx.config.providers.transcription.model,
      });
      source = 'TRANSCRIPT';
      lines = segmentsToLyricLines(transcript.segments, durationMs);
      model = transcript.model;
      modelVersion = transcript.modelVersion;
    }

    const persisted = await replaceLyrics(ctx.db, {
      projectId,
      source,
      lines,
      model,
      modelVersion,
    });

    const debugFile = lyricsDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify({ projectId, source, model, modelVersion, lines: persisted.lines }, null, 2),
    );

    // Write the normalized export to its own file, never onto the user's source
    // copy (`source-lyrics.*` from ingest), so the original bytes are preserved.
    const lrcFile = audioFile(ctx.config, projectId, 'generated-lyrics.lrc');
    await ensureDir(dirname(lrcFile.absolute));
    await writeFile(lrcFile.absolute, formatLrc(persisted.lines), 'utf8');

    // NARRATIVE fan-in is enqueued from the orchestrator's post-completion hook (F10).

    ctx.logger.info('lyrics_completed', {
      projectId,
      source,
      lineCount: persisted.lines.length,
      lrcPath: lrcFile.relative,
    });
    return {
      source,
      lineCount: persisted.lines.length,
      model,
      modelVersion,
      lrcPath: lrcFile.relative,
    };
  };
}
