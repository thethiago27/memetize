import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { LyricsInput } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import type { JobHandler } from '@memetize/orchestrator';
import {
  lyricsDebugFile,
  maybeEnqueueNarrative,
  replaceLyrics,
  resolveStorage,
} from '@memetize/projects';
import { ensureDir } from '@memetize/shared';
import { parseLrc, parseTextLines } from './parse';

const FIXTURE_MODEL = 'fixture';
const LRC_PARSER = 'lrc-parser';
const TEXT_PARSER = 'text-splitter';
const PARSER_VERSION = '1.0.0';

/**
 * LYRICS handler (spec section 26): parses a user-supplied `.lrc`/`.txt`
 * file when given one, otherwise persists an empty (instrumental) fixture —
 * never a failure. Keeps a debug snapshot, then checks the AUDIO_ANALYZE +
 * LYRICS barrier for NARRATIVE.
 */
export function createLyricsHandler(): JobHandler {
  return async (ctx) => {
    const parsed = LyricsInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId, lyricsPath, durationMs } = parsed.data;

    let source: 'USER' | 'FIXTURE' = 'FIXTURE';
    let lines: ReturnType<typeof parseLrc> = [];
    let model = FIXTURE_MODEL;

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
    }

    const persisted = await replaceLyrics(ctx.db, {
      projectId,
      source,
      lines,
      model,
      modelVersion: PARSER_VERSION,
    });

    const debugFile = lyricsDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        { projectId, source, model, modelVersion: PARSER_VERSION, lines: persisted.lines },
        null,
        2,
      ),
    );

    await maybeEnqueueNarrative(ctx.db, projectId, 'LYRICS');

    ctx.logger.info('lyrics_completed', {
      projectId,
      source,
      lineCount: persisted.lines.length,
    });
    return { source, lineCount: persisted.lines.length, model, modelVersion: PARSER_VERSION };
  };
}
