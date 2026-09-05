import { createReadStream, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { AppRuntime } from '@memetize/runtime';
import type { FastifyInstance } from 'fastify';
import { sendError } from '../errors';

/**
 * Allowed media types. There is deliberately no `application/octet-stream`
 * fallback (F16): a path whose extension is not a known media type is refused,
 * so configuration files such as `.env` (no extension) or `package.json` (under
 * the repo root, not the storage dir) can never be served. Analysis JSON, when
 * the editor needs it, belongs on its own authorized data endpoint.
 */
const CONTENT_TYPE: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** True when `target` is `root` itself or a descendant of it. */
function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

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
    // Only media types are served, and only from inside the storage directory
    // (not the whole repo root), so config files are never reachable (F16).
    const type = CONTENT_TYPE[extname(relative).toLowerCase()];
    if (!type) {
      return sendError(reply, 404, 'NOT_FOUND', 'not a served media type');
    }
    const rootDir = resolve(runtime.config.rootDir);
    const storageDir = resolve(runtime.config.storageDir);
    // Stored paths are repo-root-relative; require the result to sit under the
    // storage directory specifically.
    const absolute = resolve(rootDir, relative);
    if (!isWithin(storageDir, absolute)) {
      return sendError(reply, 400, 'INVALID_PATH', 'media path is outside the media storage');
    }

    // Resolve symlinks and re-check containment, so a symlink under storage can
    // never point a request at a file outside it; a regular file is required.
    // The storage root is resolved the same way so the comparison is not fooled
    // by symlinks in the storage path itself (e.g. /tmp -> /private/tmp).
    let realPath: string;
    let realStorageDir: string;
    let size: number;
    try {
      realStorageDir = realpathSync(storageDir);
      realPath = realpathSync(absolute);
      const stat = statSync(realPath);
      if (!stat.isFile()) {
        return sendError(reply, 404, 'NOT_FOUND', 'not a regular file');
      }
      size = stat.size;
    } catch {
      return sendError(reply, 404, 'NOT_FOUND', `file not found: ${relative}`);
    }
    if (!isWithin(realStorageDir, realPath)) {
      return sendError(reply, 400, 'INVALID_PATH', 'media path escapes the media storage');
    }
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
        .send(createReadStream(realPath, { start: range.start, end: range.end }));
    }
    reply.header('content-length', size);
    return reply.type(type).send(createReadStream(realPath));
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
