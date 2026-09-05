import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { RenderInput, type RenderWarning } from '@memetize/contracts';
import { JobFailure } from '@memetize/job-system';
import { getAsset, probeVideo } from '@memetize/media-catalog';
import type { JobHandler } from '@memetize/orchestrator';
import {
  getLatestEditWindow,
  getLatestTimeline,
  getProjectAudio,
  insertRender,
  renderDebugFile,
  renderDir,
  renderFile,
  resolveStorage,
  setProjectStatus,
} from '@memetize/projects';
import {
  buildFfmpegGraph,
  type OutputProbe,
  RENDERER_NAME,
  RENDERER_VERSION,
  type ResolvedAssets,
  toFfmpegArgs,
  validateOutput,
  validateTimeline,
} from '@memetize/renderer';
import { ensureDir } from '@memetize/shared';
import { chooseRenderSource } from './source';
import { allocateRenderTarget } from './target';

const execFileAsync = promisify(execFile);

/**
 * RENDER handler (spec sections 36-39): the first MVP that turns a
 * `Timeline` into an actual MP4. No AI, no `model-providers` import — only
 * FFmpeg/ffprobe. `DIRECTOR` never enqueues this job; only `project render`
 * (via `renderProject`/`reprocessProject`) does.
 */
export function createRenderHandler(): JobHandler {
  return async (ctx) => {
    const parsed = RenderInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { projectId, profile } = parsed.data;

    await setProjectStatus(ctx.db, projectId, 'RENDERING');

    const timelineVersion = await getLatestTimeline(ctx.db, projectId);
    if (!timelineVersion) {
      throw new JobFailure('RENDER_NO_TIMELINE', `project ${projectId} has no timeline yet`, false);
    }
    const timeline = timelineVersion.data;

    // Validate before touching any media: a stale or broken timeline must
    // fail here, not as a missing-asset error further down.
    const validationStarted = performance.now();
    const editWindow = await getLatestEditWindow(ctx.db, projectId);
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

    const graphStarted = performance.now();
    const graph = buildFfmpegGraph(timeline, {
      audioPath,
      audioDurationMs: projectAudio.durationMs,
      clips: resolvedClips,
    });
    const graphBuildMs = performance.now() - graphStarted;

    // Render to an exclusive temp file so two concurrent renders never share a
    // destination; the published, version-named path is only chosen atomically
    // when the render row is inserted, then the temp file is moved into place (F09).
    await ensureDir(renderDir(ctx.config, projectId).absolute);
    const target = await allocateRenderTarget(renderDir(ctx.config, projectId).absolute);
    const args = toFfmpegArgs(graph, target.encodingPath);

    const ffmpegStarted = performance.now();
    try {
      await execFileAsync('ffmpeg', args, {
        maxBuffer: 32 * 1024 * 1024,
        timeout: Math.max(120_000, timeline.durationMs * 4),
      });
    } catch (error) {
      await rm(target.directory, { recursive: true, force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new JobFailure('RENDER_FFMPEG_ERROR', `ffmpeg failed: ${message}`, false);
    }
    const ffmpegMs = performance.now() - ffmpegStarted;

    const probeStarted = performance.now();
    const probe = await probeOutput(target.encodingPath);
    const probeMs = performance.now() - probeStarted;
    const outputValidation = validateOutput(probe, timeline);
    if (!outputValidation.valid) {
      await rm(target.directory, { recursive: true, force: true }).catch(() => undefined);
      throw new JobFailure(
        'RENDER_OUTPUT_INVALID',
        `rendered file failed validation: ${JSON.stringify(probe)}`,
        false,
      );
    }

    const warnings: RenderWarning[] = [
      ...timelineValidation.warnings,
      ...outputValidation.warnings,
    ];
    const validation = { valid: true, warnings };

    const persisted = await insertRender(ctx.db, {
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
    });

    // Publish: move the validated temp encode to its reserved version path, then
    // drop the scratch directory. Same filesystem, so the rename is atomic.
    const publishedAbsolute = resolveStorage(ctx.config, persisted.path);
    await rename(target.encodingPath, publishedAbsolute);
    await rm(target.directory, { recursive: true, force: true }).catch(() => undefined);

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
          timelineVersion: timelineVersion.version,
          profile,
          sourceOrigins: [...sourceOrigins],
          args,
          graph,
          validation,
          performance: performanceMetrics,
        },
        null,
        2,
      ),
    );

    await setProjectStatus(ctx.db, projectId, 'COMPLETED');

    ctx.logger.info('render_completed', {
      projectId,
      version: persisted.version,
      path: persisted.path,
      profile,
      sourceOrigins: [...sourceOrigins],
      warningCount: warnings.length,
    });

    return {
      projectId,
      version: persisted.version,
      path: persisted.path,
      durationMs: persisted.durationMs,
      warningCount: warnings.length,
    };
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
