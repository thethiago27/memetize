import { createReadStream, existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { AppRuntime } from '@memetize/runtime';
import type { FastifyInstance } from 'fastify';
import { sendError } from '../errors';

const CONTENT_TYPE: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

function containsDotDot(value: string): boolean {
  try {
    return value.includes('..') || decodeURIComponent(value).includes('..');
  } catch {
    return value.includes('..');
  }
}

export function registerMediaRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  app.addHook('onRequest', async (request, reply) => {
    const raw = request.raw.url ?? request.url;
    if (!raw.includes('/v1/media')) return;
    if (containsDotDot(raw)) {
      return sendError(
        reply,
        400,
        'INVALID_PATH',
        'media path must be repo-relative and cannot contain ..',
      );
    }
  });

  app.get('/v1/media/*', async (request, reply) => {
    const params = request.params as { '*': string };
    const relative = params['*'] ?? '';
    if (!relative || containsDotDot(relative)) {
      return sendError(
        reply,
        400,
        'INVALID_PATH',
        'media path must be repo-relative and cannot contain ..',
      );
    }
    const root = resolve(runtime.config.rootDir);
    const absolute = resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
      return sendError(reply, 400, 'INVALID_PATH', 'media path escapes the repo root');
    }
    if (!existsSync(absolute)) {
      return sendError(reply, 404, 'NOT_FOUND', `file not found: ${relative}`);
    }
    const type = CONTENT_TYPE[extname(absolute).toLowerCase()] ?? 'application/octet-stream';
    return reply.type(type).send(createReadStream(absolute));
  });
}
