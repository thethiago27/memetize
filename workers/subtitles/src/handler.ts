import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type SubtitleLine, SubtitlesInput } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';
import { getLyrics, replaceSubtitles, subtitlesDebugFile } from '@memetize/projects';
import { ensureDir } from '@memetize/shared';

export const SUBTITLE_TARGET_LANGUAGE = 'pt-BR';

/**
 * SUBTITLES handler (translated-subtitles spec): translates the project's
 * lyric lines to Brazilian Portuguese. Instrumental projects persist an
 * empty row without calling a model. RENDER reads the persisted row.
 */
export function createSubtitlesHandler(): JobHandler {
  return async (ctx) => {
    const parsed = SubtitlesInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId } = parsed.data;

    const lyrics = await getLyrics(ctx.db, projectId);
    if (!lyrics) {
      throw new JobFailure('SUBTITLES_NO_LYRICS', `project ${projectId} has no lyrics yet`, false);
    }

    let language = SUBTITLE_TARGET_LANGUAGE;
    let sourceLanguage: string | null = null;
    let translated = false;
    let model = 'none';
    let modelVersion = '1.0.0';
    let lines: SubtitleLine[] = [];

    if (lyrics.lines.length === 0) {
      language = SUBTITLE_TARGET_LANGUAGE;
    } else {
      const { llm } = createProviders(ctx.config);
      const result = await llm.translateLyrics({
        lines: lyrics.lines.map((line) => line.text),
        targetLanguage: SUBTITLE_TARGET_LANGUAGE,
      });
      if (result.lines.length !== lyrics.lines.length) {
        throw new JobFailure(
          'SUBTITLES_INVALID_OUTPUT',
          `expected ${lyrics.lines.length} translated lines, got ${result.lines.length}`,
          true,
        );
      }
      sourceLanguage = result.sourceLanguage;
      translated = result.translated;
      model = result.model;
      modelVersion = result.modelVersion;
      lines = lyrics.lines.map((line, index) => {
        const text = (result.lines[index] ?? '').trim() || line.text;
        return { startMs: line.startMs, endMs: line.endMs, text };
      });
    }

    const persisted = await ctx.publish(async ({ tx }) => {
      return replaceSubtitles(tx, {
        projectId,
        language,
        sourceLanguage,
        translated,
        lines,
        model,
        modelVersion,
      });
    });

    const debugFile = subtitlesDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          language: persisted.language,
          sourceLanguage: persisted.sourceLanguage,
          translated: persisted.translated,
          model: persisted.model,
          modelVersion: persisted.modelVersion,
          lines: persisted.lines,
        },
        null,
        2,
      ),
    );

    ctx.logger.info('subtitles_completed', {
      projectId,
      lineCount: persisted.lines.length,
      translated: persisted.translated,
      model: persisted.model,
    });

    return {
      projectId,
      language: persisted.language,
      sourceLanguage: persisted.sourceLanguage,
      translated: persisted.translated,
      lineCount: persisted.lines.length,
      model: persisted.model,
      modelVersion: persisted.modelVersion,
    };
  };
}
