import { BanInput, NoteInput, ProjectFeedbackInput } from '@memetize/contracts';
import {
  banAsset,
  banMoment,
  listActiveBans,
  listFeedbackEvents,
  unbanAsset,
  unbanMoment,
} from '@memetize/feedback';
import { getAsset, getMoment } from '@memetize/media-catalog';
import { addNote, getProject, rateClip, rateProject } from '@memetize/projects';
import type { AppRuntime } from '@memetize/runtime';
import type { FastifyInstance } from 'fastify';
import { sendError, sendFeedbackError } from '../errors';

const FEEDBACK_LIST_LIMIT = 200;

/**
 * Editorial memory routes (editorial-memory spec). Every handler validates
 * with the shared Zod contracts and calls the same package helpers the CLI
 * uses; nothing here aggregates or ranks.
 */
export function registerFeedbackRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  app.post('/v1/projects/:id/feedback', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ProjectFeedbackInput.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const project = await getProject(runtime.db, id);
    if (!project) return sendError(reply, 404, 'NOT_FOUND', `project not found: ${id}`);
    try {
      const input = parsed.data;
      const event =
        input.kind === 'VIDEO_RATING'
          ? await rateProject(runtime.db, { projectId: id, value: input.value })
          : input.kind === 'NOTE'
            ? await addNote(runtime.db, { projectId: id, note: input.note })
            : await rateClip(runtime.db, { projectId: id, clipId: input.clipId, kind: input.kind });
      return reply.status(201).send({ event });
    } catch (error) {
      return sendFeedbackError(reply, error);
    }
  });

  app.post('/v1/feedback/notes', async (request, reply) => {
    const parsed = NoteInput.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const event = await addNote(runtime.db, { note: parsed.data.note });
    return reply.status(201).send({ event });
  });

  app.get('/v1/feedback', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    const events = await listFeedbackEvents(runtime.db, {
      ...(projectId ? { projectId } : {}),
      order: 'desc',
      limit: FEEDBACK_LIST_LIMIT,
    });
    return { events };
  });

  app.get('/v1/feedback/bans', async () => {
    const bans = await listActiveBans(runtime.db);
    return { momentIds: [...bans.momentIds], assetIds: [...bans.assetIds] };
  });

  app.post('/v1/moments/:id/ban', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = BanInput.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const moment = await getMoment(runtime.db, id);
    if (!moment) return sendError(reply, 404, 'NOT_FOUND', `moment not found: ${id}`);
    const event = await banMoment(runtime.db, {
      momentId: id,
      assetId: moment.assetId,
      note: parsed.data.note ?? null,
    });
    return reply.status(201).send({ event });
  });

  app.delete('/v1/moments/:id/ban', async (request, reply) => {
    const { id } = request.params as { id: string };
    const moment = await getMoment(runtime.db, id);
    if (!moment) return sendError(reply, 404, 'NOT_FOUND', `moment not found: ${id}`);
    const event = await unbanMoment(runtime.db, { momentId: id, assetId: moment.assetId });
    return { event };
  });

  app.post('/v1/assets/:id/ban', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = BanInput.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const asset = await getAsset(runtime.db, id);
    if (!asset) return sendError(reply, 404, 'NOT_FOUND', `asset not found: ${id}`);
    const event = await banAsset(runtime.db, { assetId: id, note: parsed.data.note ?? null });
    return reply.status(201).send({ event });
  });

  app.delete('/v1/assets/:id/ban', async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await getAsset(runtime.db, id);
    if (!asset) return sendError(reply, 404, 'NOT_FOUND', `asset not found: ${id}`);
    const event = await unbanAsset(runtime.db, { assetId: id });
    return { event };
  });
}
