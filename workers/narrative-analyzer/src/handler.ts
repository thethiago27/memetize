import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NarrativeInput, NarrativeSegment } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';
import {
  getAudioAnalysis,
  getLyrics,
  narrativeDebugFile,
  replaceNarrativeSegments,
  setProjectStatus,
} from '@memetize/projects';
import { ensureDir } from '@memetize/shared';

/**
 * NARRATIVE handler (spec section 27): reads the project's audio analysis
 * and lyrics (both required — the AUDIO_ANALYZE + LYRICS barrier only
 * enqueues this once both are COMPLETED), asks the configured `LLMProvider`
 * to interpret lyrics + musical structure, validates every segment falls
 * within the track's duration, persists, keeps a debug snapshot (spec
 * section 64), then advances the project to PLANNING and enqueues MATCH
 * (spec sections 28-30). Does not search moments or build a timeline
 * itself — that's the matching worker's job.
 */
export function createNarrativeHandler(): JobHandler {
  return async (ctx) => {
    const parsed = NarrativeInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId } = parsed.data;

    const audio = await getAudioAnalysis(ctx.db, projectId);
    if (!audio) {
      throw new JobFailure(
        'NARRATIVE_NO_AUDIO',
        `project ${projectId} has no audio analysis yet`,
        false,
      );
    }
    const lyricsRow = await getLyrics(ctx.db, projectId);
    if (!lyricsRow) {
      throw new JobFailure('NARRATIVE_NO_LYRICS', `project ${projectId} has no lyrics yet`, false);
    }

    const { llm } = createProviders(ctx.config);

    let suggestion: Awaited<ReturnType<typeof llm.analyzeNarrative>>;
    try {
      suggestion = await llm.analyzeNarrative({
        durationMs: audio.durationMs,
        sections: audio.sections,
        energyCurve: audio.energyCurve,
        lyrics: lyricsRow.lines,
      });
    } catch (error) {
      throw new JobFailure(
        'NARRATIVE_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    const segments: NarrativeSegment[] = [];
    for (const candidate of suggestion.segments) {
      if (candidate.startMs < 0 || candidate.endMs > audio.durationMs) {
        throw new JobFailure(
          'NARRATIVE_OUT_OF_BOUNDS',
          `segment [${candidate.startMs}, ${candidate.endMs}] falls outside [0, ${audio.durationMs}]`,
          false,
        );
      }
      segments.push(NarrativeSegment.parse(candidate));
    }

    const persisted = await replaceNarrativeSegments(ctx.db, {
      projectId,
      segments,
      extractor: suggestion.extractor,
      extractorVersion: suggestion.extractorVersion,
    });

    const debugFile = narrativeDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          promptVersion: suggestion.promptVersion,
          extractor: suggestion.extractor,
          extractorVersion: suggestion.extractorVersion,
          raw: suggestion.segments,
          parsed: persisted,
        },
        null,
        2,
      ),
    );

    // The matching funnel (spec sections 28-30) only makes sense once the
    // project has a semantic timeline; PLANNING is the project's next
    // lifecycle stage after ANALYZING_AUDIO (spec section 41).
    await setProjectStatus(ctx.db, projectId, 'PLANNING');
    await ctx.enqueue({ type: 'MATCH', entityId: projectId, input: { projectId } });

    ctx.logger.info('narrative_completed', {
      projectId,
      segmentCount: persisted.length,
      extractor: suggestion.extractor,
    });
    return {
      segmentCount: persisted.length,
      extractor: suggestion.extractor,
      extractorVersion: suggestion.extractorVersion,
      promptVersion: suggestion.promptVersion,
    };
  };
}
