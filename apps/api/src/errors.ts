import { ProjectFeedbackError, SwapClipError } from '@memetize/projects';
import type { FastifyReply } from 'fastify';

export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

export function sendSwapError(reply: FastifyReply, error: unknown) {
  if (error instanceof SwapClipError) {
    const status =
      error.code === 'NOT_IN_SHORTLIST' ||
      error.code === 'MOMENT_TOO_SHORT' ||
      error.code === 'MOMENT_BANNED'
        ? 409
        : 404;
    return sendError(reply, status, error.code, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return sendError(reply, 500, 'INTERNAL', message);
}

export function sendFeedbackError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProjectFeedbackError) {
    return sendError(reply, 404, error.code, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return sendError(reply, 500, 'INTERNAL', message);
}
