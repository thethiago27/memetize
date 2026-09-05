import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { RenderInput, type RenderWarning } from '@memetize/contracts';
import type { Executor } from '@memetize/database';
import { JobFailure } from '@memetize/job-system';
import { getAsset, probeVideo } from '@memetize/media-catalog';
import type { JobHandler } from '@memetize/orchestrator';
import {
  getEditWindowByVersion,
  getLatestEditWindow,
  getLyrics,
  getProjectAudio,
  getSubtitles,
  insertRender,
  renderDebugFile,
  renderDir,
  renderFile,
  resolveSourceTimeline,
  resolveStorage,
  setProjectStatus,
} from '@memetize/projects';
import {
  buildFfmpegGraph,
  cuesFromLyrics,
  layoutCue,
  type OutputProbe,
  RENDERER_NAME,
  RENDERER_VERSION,
  type RenderedCue,
  type ResolvedAssets,
  rasterizeCue,
  toFfmpegArgs,
  validateOutput,
  validateTimeline,
} from '@memetize/renderer';
import { ensureDir } from '@memetize/shared';
import type { Timeline } from '@memetize/timeline';
import { chooseRenderSource } from './source';
import { allocateRenderTarget, cleanupOrphanRenderAttempts } from './target';

const execFileAsync = promisify(execFile);

/**
 * RENDER handler (spec sections 36-39): the first MVP that turns a
 * `Timeline` into an actual MP4. No AI, no `model-providers` import — only
 * FFmpeg/ffprobe. `DIRECTOR` never enqueues this job; only `project render`
 * (via `renderProject`/`reprocessProject`) does.
 *
 * Inputs are pinned (F11): the job names the timeline version and edit window
 * version it must render, and a missing pinned row fails the job instead of
 * silently rendering "latest". Publication is atomic (F08/F09): the render row,
 * the move of the validated file to its version-named path, the project status
 * and the job completion commit in one transaction under the project lock, only
 * while this attempt still owns the job and its generation is still active.
 */
export function createRenderHandler(): JobHandler {
  return async (ctx) => {
    const parsed = RenderInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId, profile, sourceTimelineVersion, editWindowVersion } = parsed.data;

    await setProjectStatus(ctx.db, projectId, 'RENDERING');

    const source = await resolveSourceTimeline(ctx.db, projectId, sourceTimelineVersion);
    const timelineVersion = source.row;
    if (!timelineVersion) {
      throw source.pinned
        ? new JobFailure(
            'RENDER_STALE_SOURCE',
            `project ${projectId} no longer has timeline v${sourceTimelineVersion}`,
            false,
          )
        : new JobFailure('RENDER_NO_TIMELINE', `project ${projectId} has no timeline yet`, false);
    }
    const timeline = timelineVersion.data;

    const editWindow =
      editWindowVersion !== undefined
        ? await getEditWindowByVersion(ctx.db, projectId, editWindowVersion)
        : await getLatestEditWindow(ctx.db, projectId);
    if (editWindowVersion !== undefined && !editWindow) {
      throw new JobFailure(
        'RENDER_STALE_SOURCE',
        `project ${projectId} no longer has edit window v${editWindowVersion}`,
        false,
      );
    }

    // Validate before touching any media: a stale or broken timeline must
    // fail here, not as a missing-asset error further down.
    const validationStarted = performance.now();
    const timelineValidation = validateTimeline(timeline, {
      expectedDurationMs: editWindow?.durationMs,
      expectedWindowStartMs: editWindow?.sourceStartMs,
    });
    const validationMs = performance.now() - validationStarted;
    if (!timelineValidation.ok) {
      throw new JobFailure(
        'RENDER_INVALID_TIMELINE',
        timelineValidation.errors.map((error) => error.message).join('; '),
        false,
      );
    }

    const projectAudio = await getProjectAudio(ctx.db, projectId);
    if (!projectAudio) {
      throw new JobFailure('RENDER_MISSING_ASSET', `project ${projectId} has no audio file`, false);
    }
    const audioPath = resolveStorage(ctx.config, projectAudio.originalPath);
    if (!existsSync(audioPath)) {
      throw new JobFailure(
        'RENDER_MISSING_ASSET',
        `audio file missing on disk: ${audioPath}`,
        false,
      );
    }

    const resolvedClips: ResolvedAssets['clips'][number][] = [];
    const sourceOrigins = new Set<string>();
    for (const clip of timeline.clips) {
      const asset = await getAsset(ctx.db, clip.source.assetId);
      if (!asset) {
        throw new JobFailure(
          'RENDER_MISSING_ASSET',
          `clip "${clip.id}" references unknown asset "${clip.source.assetId}"`,
          false,
        );
      }
      // A final export reads the original; only a preview may use the proxy (F06).
      let chosen: ReturnType<typeof chooseRenderSource>;
      try {
        chosen = chooseRenderSource(asset, profile);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new JobFailure(
          'RENDER_MISSING_ASSET',
          `clip "${clip.id}" asset "${clip.source.assetId}" has no usable ${profile} source: ${message}`,
          false,
        );
      }
      const videoPath = resolveStorage(ctx.config, chosen.path);
      if (!existsSync(videoPath)) {
        throw new JobFailure(
          'RENDER_MISSING_ASSET',
          `asset file missing on disk: ${videoPath}`,
          false,
        );
      }
      sourceOrigins.add(chosen.origin);
      resolvedClips.push({ clipId: clip.id, videoPath });
    }

    // Render to an exclusive temp file so two concurrent renders never share a
    // destination; the published, version-named path is only chosen atomically
    // when the render row is inserted (F09). Orphans of earlier crashed attempts
    // are swept first. Caption PNGs live in the same attempt directory.
    const rendersDirectory = renderDir(ctx.config, projectId).absolute;
    await ensureDir(rendersDirectory);
    const orphansRemoved = await cleanupOrphanRenderAttempts(rendersDirectory);
    if (orphansRemoved > 0) ctx.logger.warn('render_orphans_removed', { orphansRemoved });
    const target = await allocateRenderTarget(rendersDirectory);
    const discardAttempt = () =>
      rm(target.directory, { recursive: true, force: true }).catch(() => undefined);

    let renderedCues: RenderedCue[] = [];
    let subtitleMeta: {
      lineCount: number;
      cueCount: number;
      translated: boolean;
      model: string;
    } | null = null;
    try {
      const prepared = await prepareRenderedCues(ctx.db, projectId, timeline, target.directory);
      renderedCues = prepared.cues;
      subtitleMeta = prepared.meta;
    } catch (error) {
      await discardAttempt();
      throw error;
    }

    const graphStarted = performance.now();
    const graph = buildFfmpegGraph(
      timeline,
      {
        audioPath,
        audioDurationMs: projectAudio.durationMs,
        clips: resolvedClips,
      },
      renderedCues.length > 0 ? { subtitles: renderedCues } : undefined,
    );
    const graphBuildMs = performance.now() - graphStarted;

    const args = toFfmpegArgs(graph, target.encodingPath);
    const ffmpegStarted = performance.now();
    try {
      await execFileAsync('ffmpeg', args, {
        maxBuffer: 32 * 1024 * 1024,
        timeout: Math.max(120_000, timeline.durationMs * 4),
      });
    } catch (error) {
      await discardAttempt();
      const message = error instanceof Error ? error.message : String(error);
      throw new JobFailure('RENDER_FFMPEG_ERROR', `ffmpeg failed: ${message}`, false);
    }
    const ffmpegMs = performance.now() - ffmpegStarted;

    const probeStarted = performance.now();
    const probe = await probeOutput(target.encodingPath);
    const probeMs = performance.now() - probeStarted;
    const outputValidation = validateOutput(probe, timeline);
    if (!outputValidation.valid) {
      await discardAttempt();
      throw new JobFailure(
        'RENDER_OUTPUT_INVALID',
        `rendered file failed validation: ${JSON.stringify({ probe, warnings: outputValidation.warnings })}`,
        false,
      );
    }

    // The encode is validated: park it as `ready.mp4` so only a proven artifact
    // can ever be moved to a published path.
    await rename(target.encodingPath, target.readyPath);

    const warnings: RenderWarning[] = [
      ...timelineValidation.warnings,
      ...outputValidation.warnings,
    ];
    const validation = { valid: true, warnings };

    let result: Record<string, unknown>;
    try {
      result = await ctx.publish(async ({ tx }) => {
        const persisted = await insertRender(tx, {
          projectId,
          timelineVersion: timelineVersion.version,
          pathForVersion: (version) => renderFile(ctx.config, projectId, version).relative,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          fps: Math.round(probe.fpsMilli / 1000),
          videoCodec: probe.videoCodec ?? 'unknown',
          audioCodec: probe.audioCodec ?? 'unknown',
          renderer: RENDERER_NAME,
          rendererVersion: RENDERER_VERSION,
          validation,
          // Same filesystem, so the move is atomic; it runs before commit, so a
          // committed row always has its file in place (F09).
          publishFile: (row) => rename(target.readyPath, resolveStorage(ctx.config, row.path)),
        });
        await setProjectStatus(tx, projectId, 'COMPLETED');
        return {
          projectId,
          version: persisted.version,
          path: persisted.path,
          durationMs: persisted.durationMs,
          warningCount: warnings.length,
          timelineVersion: timelineVersion.version,
          editWindowVersion: editWindow?.version ?? null,
          profile,
        };
      });
    } catch (error) {
      // Lease lost, generation superseded, or a failed publish: the validated
      // file is an orphan now; drop it and let the orchestrator record the outcome.
      await discardAttempt();
      throw error;
    }
    await discardAttempt();

    const performanceMetrics = {
      validationMs,
      graphBuildMs,
      ffmpegMs,
      probeMs,
      clipCount: timeline.clips.length,
      uniqueSourceCount: new Set(resolvedClips.map((clip) => clip.videoPath)).size,
    };

    const debugFile = renderDebugFile(ctx.config, projectId);
    await ensureDir(dirname(debugFile.absolute));
    await writeFile(
      debugFile.absolute,
      JSON.stringify(
        {
          projectId,
          generationId: ctx.job.generationId,
          renderVersion: result.version,
          timelineVersion: timelineVersion.version,
          editWindowVersion: editWindow?.version ?? null,
          profile,
          sourceOrigins: [...sourceOrigins],
          args,
          graph,
          probe,
          validation,
          performance: performanceMetrics,
          subtitles: subtitleMeta,
        },
        null,
        2,
      ),
    );

    ctx.logger.info('render_completed', {
      projectId,
      version: result.version,
      path: result.path,
      profile,
      sourceOrigins: [...sourceOrigins],
      warningCount: warnings.length,
    });

    return result;
  };
}

async function prepareRenderedCues(
  db: Executor,
  projectId: string,
  timeline: Timeline,
  attemptDirectory: string,
): Promise<{
  cues: RenderedCue[];
  meta: { lineCount: number; cueCount: number; translated: boolean; model: string } | null;
}> {
  const lyrics = await getLyrics(db, projectId);
  const row = await getSubtitles(db, projectId);
  if ((lyrics?.lines.length ?? 0) > 0 && !row) {
    throw new JobFailure(
      'RENDER_SUBTITLES_MISSING',
      `project ${projectId} has lyrics but no subtitles yet — wait for SUBTITLES or run project reprocess ${projectId} --from subtitles`,
      false,
    );
  }
  if (!row || row.lines.length === 0) {
    return { cues: [], meta: null };
  }

  const planned = cuesFromLyrics(row.lines, timeline);
  const directory = join(attemptDirectory, 'subtitles');
  await mkdir(directory, { recursive: true });
  const cues: RenderedCue[] = [];
  for (const [index, cue] of planned.entries()) {
    const layout = layoutCue(cue.text, timeline.canvas);
    const pngPath = join(directory, `cue-${index}.png`);
    await writeFile(pngPath, rasterizeCue(layout));
    cues.push({
      pngPath,
      startMs: cue.startMs,
      endMs: cue.endMs,
      width: layout.width,
      height: layout.height,
    });
  }
  return {
    cues,
    meta: {
      lineCount: row.lines.length,
      cueCount: cues.length,
      translated: row.translated,
      model: row.model,
    },
  };
}

const BROKEN_PROBE: Omit<OutputProbe, 'exists'> = {
  durationMs: 0,
  width: 0,
  height: 0,
  fpsMilli: 0,
  videoCodec: null,
  audioCodec: null,
  videoDurationMs: null,
  audioDurationMs: null,
  videoStartMs: null,
  audioStartMs: null,
};

/**
 * A missing file or a file `ffprobe` can't make sense of (e.g. no video
 * stream) both turn into `validateOutput`'s `RENDER_OUTPUT_INVALID` path
 * instead of letting `probeVideo` throw past this handler.
 */
async function probeOutput(path: string): Promise<OutputProbe> {
  if (!existsSync(path)) {
    return { exists: false, ...BROKEN_PROBE };
  }
  try {
    const probe = await probeVideo(path);
    return { exists: true, ...probe };
  } catch {
    return { exists: true, ...BROKEN_PROBE };
  }
}
