import { createReadStream, existsSync, statSync } from 'node:fs';
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
    const size = statSync(absolute).size;
    reply.header('accept-ranges', 'bytes');

    // Browsers seek inside <video>/<audio> only when the server honors byte
    // ranges; without this every seek restarts the download from zero.
    const range = parseRange(request.headers.range, size);
    if (range === 'invalid') {
      reply.header('content-range', `bytes */${size}`);
      return sendError(reply, 416, 'RANGE_NOT_SATISFIABLE', 'requested range not satisfiable');
    }
    if (range) {
      reply
        .code(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
        .header('content-length', range.end - range.start + 1);
      return reply
        .type(type)
        .send(createReadStream(absolute, { start: range.start, end: range.end }));
    }
    reply.header('content-length', size);
    return reply.type(type).send(createReadStream(absolute));
  });
}

/**
 * One `bytes=start-end` range against a file size: `null` when the header is
 * absent, `'invalid'` when nothing in it can be served. Multi-range requests
 * fall back to the whole file, which browsers accept.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === '' && endText === '') return 'invalid';
  if (size === 0) return 'invalid';
  if (startText === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(endText);
    if (suffix === 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
