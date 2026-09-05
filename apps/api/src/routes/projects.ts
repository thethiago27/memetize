import { ProjectReprocessFrom, ReprocessBody, SwapClipInput } from '@memetize/contracts';
import { listJobsForEntity } from '@memetize/job-system';
import { describeProviders } from '@memetize/model-providers';
import {
  clearManualWindow,
  deleteProject,
  generateTimeline,
  getAudioAnalysis,
  getLatestEditWindow,
  getLatestRender,
  getLatestTimeline,
  getLyrics,
  getProject,
  getProjectGeneration,
  ingestProject,
  listNarrativeSegments,
  listProjectFeedback,
  listProjects,
  listRenders,
  listSegmentMatches,
  listTimelineVersions,
  ManualWindowError,
  ProjectBusyError,
  renderProject,
  reprocessProject,
  setManualWindow,
  summarizeMoments,
  swapClip,
} from '@memetize/projects';
import type { AppRuntime } from '@memetize/runtime';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { kickDrain } from '../drain';
import { sendError, sendSwapError } from '../errors';
import { removeUpload, saveUpload } from '../upload';

export function registerProjectRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  app.get('/v1/projects', async () => {
    const rows = await listProjects(runtime.db);
    const projects = await Promise.all(
      rows.map(async (row) => {
        const [audio, timeline, render, editWindow] = await Promise.all([
          getAudioAnalysis(runtime.db, row.id),
          getLatestTimeline(runtime.db, row.id),
          getLatestRender(runtime.db, row.id),
          getLatestEditWindow(runtime.db, row.id),
        ]);
        return {
          ...row,
          durationMs: audio?.durationMs ?? null,
          timelineVersion: timeline?.version ?? null,
          renderVersion: render?.version ?? null,
          outputDurationMs: editWindow?.durationMs ?? null,
          sourceStartMs: editWindow?.sourceStartMs ?? null,
          sourceEndMs: editWindow?.sourceEndMs ?? null,
        };
      }),
    );
    return { projects };
  });

  app.get('/v1/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(runtime.db, id);
    if (!project) return sendError(reply, 404, 'NOT_FOUND', `project not found: ${id}`);
    const [
      audio,
      lyrics,
      narrative,
      matches,
      timeline,
      render,
      renders,
      jobs,
      editWindow,
      feedback,
    ] = await Promise.all([
      getAudioAnalysis(runtime.db, id),
      getLyrics(runtime.db, id),
      listNarrativeSegments(runtime.db, id),
      listSegmentMatches(runtime.db, id),
      getLatestTimeline(runtime.db, id),
      getLatestRender(runtime.db, id),
      listRenders(runtime.db, id),
      listJobsForEntity(runtime.db, id),
      getLatestEditWindow(runtime.db, id),
      listProjectFeedback(runtime.db, id),
    ]);
    const momentIds = new Set<string>();
    for (const clip of timeline?.data.clips ?? []) momentIds.add(clip.momentId);
    for (const match of matches) for (const entry of match.shortlist) momentIds.add(entry.momentId);
    const moments = await summarizeMoments(runtime.db, momentIds);
    return {
      project,
      // Which capabilities produced this project's analysis for real vs. simulated (F01).
      providers: describeProviders(runtime.config),
      generationId: await getProjectGeneration(runtime.db, id),
      audio,
      lyrics,
      narrative,
      matches,
      timeline,
      render,
      renders,
      jobs,
      editWindow: editWindow ?? null,
      manualWindow:
        project.manualWindowStartMs !== null && project.manualWindowEndMs !== null
          ? { sourceStartMs: project.manualWindowStartMs, sourceEndMs: project.manualWindowEndMs }
          : null,
      feedback,
      moments,
    };
  });

  app.get('/v1/projects/:id/timelines', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(runtime.db, id);
    if (!project) return sendError(reply, 404, 'NOT_FOUND', `project not found: ${id}`);
    return { timelines: await listTimelineVersions(runtime.db, id) };
  });

  app.get('/v1/projects/:id/renders', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(runtime.db, id);
    if (!project) return sendError(reply, 404, 'NOT_FOUND', `project not found: ${id}`);
    return { renders: await listRenders(runtime.db, id) };
  });

  app.post('/v1/projects', async (request, reply) => {
    const parts = request.parts();
    let audioPath: string | undefined;
    let audioName: string | undefined;
    let lyricsPath: string | undefined;
    const temps: string[] = [];
    try {
      for await (const part of parts) {
        if (part.type !== 'file') continue;
        const saved = await saveUpload(part);
        temps.push(saved.path);
        if (part.fieldname === 'lyrics') {
          lyricsPath = saved.path;
        } else {
          audioPath = saved.path;
          audioName = saved.originalName;
        }
      }
      if (!audioPath) return sendError(reply, 400, 'NO_FILE', 'expected an audio file field');
      const { project } = await ingestProject({
        db: runtime.db,
        config: runtime.config,
        filePath: audioPath,
        lyricsPath,
        displayName: audioName,
      });
      kickDrain(runtime, project.id);
      return reply.status(201).send({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 400, 'INGEST_FAILED', message);
    } finally {
      await Promise.all(temps.map((path) => removeUpload(path)));
    }
  });

  app.delete('/v1/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const deleted = await deleteProject({
        db: runtime.db,
        config: runtime.config,
        projectId: id,
      });
      if (!deleted) return sendError(reply, 404, 'NOT_FOUND', `project not found: ${id}`);
    } catch (error) {
      if (error instanceof ProjectBusyError)
        return sendError(reply, 409, error.code, error.message);
      throw error;
    }
    return { ok: true };
  });

  app.put('/v1/projects/:id/window', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const manualWindow = await setManualWindow(runtime.db, id, request.body);
      kickDrain(runtime, id);
      return { ok: true, manualWindow };
    } catch (error) {
      return sendWindowError(reply, error);
    }
  });

  app.delete('/v1/projects/:id/window', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await clearManualWindow(runtime.db, id);
      kickDrain(runtime, id);
      return { ok: true };
    } catch (error) {
      return sendWindowError(reply, error);
    }
  });

  app.post('/v1/projects/:id/generate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(runtime.db, id);
    if (!project) return sendError(reply, 404, 'NOT_FOUND', `project not found: ${id}`);
    try {
      await generateTimeline(runtime.db, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 409, 'GENERATE_FAILED', message);
    }
    kickDrain(runtime, id);
    return { ok: true };
  });

  app.post('/v1/projects/:id/render', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(runtime.db, id);
    if (!project) return sendError(reply, 404, 'NOT_FOUND', `project not found: ${id}`);
    try {
      await renderProject(runtime.db, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 409, 'RENDER_FAILED', message);
    }
    kickDrain(runtime, id);
    return { ok: true };
  });

  app.post('/v1/projects/:id/reprocess', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ReprocessBody.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const from = ProjectReprocessFrom.safeParse(parsed.data.from);
    if (!from.success) return sendError(reply, 400, 'INVALID_INPUT', from.error.message);
    const project = await getProject(runtime.db, id);
    if (!project) return sendError(reply, 404, 'NOT_FOUND', `project not found: ${id}`);
    await reprocessProject(runtime.db, id, from.data);
    kickDrain(runtime, id);
    return { ok: true, from: from.data };
  });

  app.post('/v1/projects/:id/clips/:clipId/swap', async (request, reply) => {
    const { id, clipId } = request.params as { id: string; clipId: string };
    const parsed = SwapClipInput.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    try {
      const { timeline, events } = await swapClip(runtime.db, {
        projectId: id,
        clipId,
        momentId: parsed.data.momentId,
        expectedTimelineVersion: parsed.data.expectedTimelineVersion,
      });
      // Each swap event carries its own FEEDBACK_EMBED job keyed by event id.
      for (const event of events) kickDrain(runtime, event.id);
      return { timeline, events };
    } catch (error) {
      return sendSwapError(reply, error);
    }
  });
}

function sendWindowError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProjectBusyError) return sendError(reply, 409, error.code, error.message);
  if (error instanceof ManualWindowError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'NO_AUDIO' ? 409 : 400;
    return sendError(reply, status, error.code, error.message);
  }
  throw error;
}
