import { AssetBusyError, AssetStateError } from '@memetize/media-catalog';
import {
  ManualWindowError,
  ProjectBusyError,
  ProjectFeedbackError,
  ProjectStateError,
  SwapClipError,
} from '@memetize/projects';
import { StoragePathError } from '@memetize/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

/**
 * The single mapping from a domain error to its HTTP status. Every route uses
 * it, so a busy project answers `409 PROJECT_BUSY` with its own code — as the
 * README documents — instead of being flattened into one route-specific code
 * or escaping as a 500. Returns null for anything it does not recognize, so the
 * caller can decide (rethrow to the error handler, or map it itself).
 */
export function statusForDomainError(error: unknown): number | null {
  if (error instanceof ProjectBusyError || error instanceof AssetBusyError) return 409;
  if (error instanceof ManualWindowError) {
    if (error.code === 'NOT_FOUND') return 404;
    return error.code === 'NO_AUDIO' ? 409 : 400;
  }
  if (error instanceof SwapClipError) {
    return error.code === 'NOT_IN_SHORTLIST' ||
      error.code === 'MOMENT_TOO_SHORT' ||
      error.code === 'MOMENT_BANNED' ||
      error.code === 'VERSION_CONFLICT'
      ? 409
      : 404;
  }
  if (error instanceof ProjectFeedbackError) return 404;
  // A command's precondition on the entity's own state: the caller asked for
  // something the project/asset is not ready for, which is a conflict, not a
  // server error.
  if (error instanceof ProjectStateError) return 409;
  if (error instanceof AssetStateError) return error.code === 'NOT_FOUND' ? 404 : 409;
  if (error instanceof StoragePathError) return 400;
  return null;
}

/**
 * Answers a command route's failure. A recognized domain error keeps its own
 * code and status; anything else is rethrown so the app-level error handler
 * turns it into a 500 without inventing a domain code for it.
 */
export function sendCommandError(reply: FastifyReply, error: unknown): FastifyReply | never {
  const status = statusForDomainError(error);
  if (status === null) throw error;
  const code = (error as { code: string }).code;
  const message = error instanceof Error ? error.message : String(error);
  return sendError(reply, status, code, message);
}

export function sendSwapError(reply: FastifyReply, error: unknown) {
  return sendCommandError(reply, error);
}

export function sendFeedbackError(reply: FastifyReply, error: unknown) {
  return sendCommandError(reply, error);
}

/**
 * The app's single error handler: everything that reaches it answers in the
 * same `{ error: { code, message } }` envelope the routes use, rather than
 * Fastify's default `{ statusCode, error, message }`. A recognized domain error
 * keeps its code; a validation error is a 400; anything else is a 500 whose
 * message is fixed — an internal message (a Postgres error text, a file path)
 * is logged, never returned to the client.
 */
export function registerErrorHandler(
  app: FastifyInstance,
  log: (event: string, fields: Record<string, unknown>) => void,
): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const domainStatus = statusForDomainError(error);
    if (domainStatus !== null) {
      return sendError(reply, domainStatus, (error as { code: string }).code, error.message);
    }
    if (error.validation || error.statusCode === 400) {
      return sendError(reply, 400, 'INVALID_INPUT', error.message);
    }
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status < 500) {
      return sendError(reply, status, error.code ?? 'REQUEST_FAILED', error.message);
    }
    log('api_unhandled_error', {
      method: request.method,
      url: request.url,
      message: error.message,
      stack: error.stack,
    });
    return sendError(reply, 500, 'INTERNAL', 'internal server error');
  });
}
