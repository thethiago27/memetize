import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NarrativeInput, NarrativeSegment } from '@memetize/contracts';
import { planNarrativeCoverage } from '@memetize/edit-planner';
import { JobFailure } from '@memetize/job-system';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';
import {
  getAudioAnalysis,
  getLyrics,
  insertEditWindow,
  ManualWindowError,
  narrativeDebugFile,
  replaceNarrativeSegments,
  resolveEditWindow,
  setProjectStatus,
} from '@memetize/projects';
import { ensureDir } from '@memetize/shared';

/**
 * NARRATIVE handler: selects a source window, asks the LLM for meaning
 * inside that window, then normalizes continuous coverage before MATCH.
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

    let selection: Awaited<ReturnType<typeof resolveEditWindow>>;
    try {
      selection = await resolveEditWindow(ctx.db, projectId, {
        trackDurationMs: audio.durationMs,
        sections: audio.sections,
        beats: audio.beats,
        downbeats: audio.downbeats,
        energyCurve: audio.energyCurve,
        lyrics: lyricsRow.lines,
      });
    } catch (error) {
      if (error instanceof ManualWindowError) {
        throw new JobFailure('MANUAL_WINDOW_INVALID', error.message, false);
      }
      throw new JobFailure(
        'HIGHLIGHT_INVALID_ANALYSIS',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }
    const window = await insertEditWindow(ctx.db, { projectId, selection });

    const { llm } = createProviders(ctx.config);

    let suggestion: Awaited<ReturnType<typeof llm.analyzeNarrative>>;
    try {
      suggestion = await llm.analyzeNarrative({
        durationMs: audio.durationMs,
        sourceStartMs: window.sourceStartMs,
        sourceEndMs: window.sourceEndMs,
        sections: clipRanges(audio.sections, window.sourceStartMs, window.sourceEndMs),
        energyCurve: audio.energyCurve.filter(
          (point) => point.timeMs >= window.sourceStartMs && point.timeMs <= window.sourceEndMs,
        ),
        lyrics: clipRanges(lyricsRow.lines, window.sourceStartMs, window.sourceEndMs).map(
          (line) => ({ startMs: line.startMs, endMs: line.endMs, text: line.text }),
        ),
      });
    } catch (error) {
      throw new JobFailure(
        'NARRATIVE_ERROR',
        error instanceof Error ? error.message : String(error),
        false,
      );
    }

    const beats = uniqueSorted([...audio.beats.map((beat) => beat.timeMs), ...audio.downbeats]);
    const normalized = planNarrativeCoverage({
      window: { sourceStartMs: window.sourceStartMs, sourceEndMs: window.sourceEndMs },
      suggestions: suggestion.segments,
      sections: audio.sections,
      beats,
      energyCurve: audio.energyCurve,
    });
    validateCoverage(normalized, window.sourceStartMs, window.sourceEndMs);

    const segments = normalized.map((segment) => NarrativeSegment.parse(segment));
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
          window: {
            version: window.version,
            sourceStartMs: window.sourceStartMs,
            sourceEndMs: window.sourceEndMs,
            durationMs: window.durationMs,
            score: window.score,
            scoreBreakdown: window.scoreBreakdown,
            selector: window.selector,
            selectorVersion: window.selectorVersion,
          },
          raw: suggestion.segments,
          parsed: persisted,
        },
        null,
        2,
      ),
    );

    await setProjectStatus(ctx.db, projectId, 'PLANNING');
    await ctx.enqueue({ type: 'MATCH', entityId: projectId, input: { projectId } });

    ctx.logger.info('narrative_completed', {
      projectId,
      segmentCount: persisted.length,
      extractor: suggestion.extractor,
      windowVersion: window.version,
    });
    return {
      segmentCount: persisted.length,
      extractor: suggestion.extractor,
      extractorVersion: suggestion.extractorVersion,
      promptVersion: suggestion.promptVersion,
      windowVersion: window.version,
    };
  };
}

function clipRanges<T extends { startMs: number; endMs: number }>(
  ranges: readonly T[],
  windowStartMs: number,
  windowEndMs: number,
): T[] {
  const clipped: T[] = [];
  for (const range of ranges) {
    const startMs = Math.max(range.startMs, windowStartMs);
    const endMs = Math.min(range.endMs, windowEndMs);
    if (startMs >= endMs) continue;
    clipped.push({ ...range, startMs, endMs });
  }
  return clipped;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function validateCoverage(
  segments: NarrativeSegment[],
  sourceStartMs: number,
  sourceEndMs: number,
): void {
  if (segments.length === 0) {
    throw new JobFailure(
      'NARRATIVE_COVERAGE_INVALID',
      `normalized coverage is empty for window [${sourceStartMs}, ${sourceEndMs}]`,
      false,
    );
  }
  if (segments[0]?.startMs !== sourceStartMs || segments.at(-1)?.endMs !== sourceEndMs) {
    throw new JobFailure(
      'NARRATIVE_COVERAGE_INVALID',
      `normalized spans do not cover [${sourceStartMs}, ${sourceEndMs}]`,
      false,
    );
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || segment.endMs <= segment.startMs) {
      throw new JobFailure(
        'NARRATIVE_COVERAGE_INVALID',
        'normalized span has a non-positive duration',
        false,
      );
    }
    if (segment.startMs < sourceStartMs || segment.endMs > sourceEndMs) {
      throw new JobFailure(
        'NARRATIVE_COVERAGE_INVALID',
        `span [${segment.startMs}, ${segment.endMs}] falls outside [${sourceStartMs}, ${sourceEndMs}]`,
        false,
      );
    }
    const next = segments[index + 1];
    if (next && segment.endMs !== next.startMs) {
      throw new JobFailure(
        'NARRATIVE_COVERAGE_INVALID',
        'normalized spans are not contiguous',
        false,
      );
    }
  }
}
