import { EmbeddingType, SearchQuery } from '@memetize/contracts';
import { searchMoments } from '@memetize/retriever';
import type { AppRuntime } from '@memetize/runtime';
import type { FastifyInstance } from 'fastify';
import { sendError } from '../errors';

export function registerSearchRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  app.get('/v1/search', async (request, reply) => {
    const parsed = SearchQuery.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const type = EmbeddingType.safeParse(parsed.data.type);
    if (!type.success) return sendError(reply, 400, 'INVALID_INPUT', type.error.message);
    const hits = await searchMoments(runtime.db, runtime.config, {
      query: parsed.data.q,
      type: type.data,
      limit: parsed.data.limit,
    });
    return { hits };
  });
}
