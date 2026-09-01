import { ProjectReprocessFrom, ReprocessBody, SwapClipInput } from '@memetize/contracts';
import { listJobsForEntity } from '@memetize/job-system';
import {
  generateTimeline,
  getAudioAnalysis,
  getLatestEditWindow,
  getLatestRender,
  getLatestTimeline,
  getLyrics,
  getProject,
  ingestProject,
  listNarrativeSegments,
  listProjects,
  listRenders,
  listSegmentMatches,
  listTimelineVersions,
  renderProject,
  reprocessProject,
  swapClip,
} from '@memetize/projects';
import type { AppRuntime } from '@memetize/runtime';
import type { FastifyInstance } from 'fastify';
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
    const [audio, lyrics, narrative, matches, timeline, render, renders, jobs, editWindow] =
      await Promise.all([
        getAudioAnalysis(runtime.db, id),
        getLyrics(runtime.db, id),
        listNarrativeSegments(runtime.db, id),
        listSegmentMatches(runtime.db, id),
        getLatestTimeline(runtime.db, id),
        getLatestRender(runtime.db, id),
        listRenders(runtime.db, id),
        listJobsForEntity(runtime.db, id),
        getLatestEditWindow(runtime.db, id),
      ]);
    return {
      project,
      audio,
      lyrics,
      narrative,
      matches,
      timeline,
      render,
      renders,
      jobs,
      editWindow: editWindow ?? null,
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
    let lyricsPath: string | undefined;
    const temps: string[] = [];
    try {
      for await (const part of parts) {
        if (part.type !== 'file') continue;
        const tmp = await saveUpload(part);
        temps.push(tmp);
        if (part.fieldname === 'lyrics') lyricsPath = tmp;
        else audioPath = tmp;
      }
      if (!audioPath) return sendError(reply, 400, 'NO_FILE', 'expected an audio file field');
      const { project } = await ingestProject({
        db: runtime.db,
        config: runtime.config,
        filePath: audioPath,
        lyricsPath,
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
      const timeline = await swapClip(runtime.db, {
        projectId: id,
        clipId,
        momentId: parsed.data.momentId,
      });
      return { timeline };
    } catch (error) {
      return sendSwapError(reply, error);
    }
  });
}
