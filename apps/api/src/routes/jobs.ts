import { listJobsForEntity } from '@memetize/job-system';
import type { AppRuntime } from '@memetize/runtime';
import type { FastifyInstance } from 'fastify';
import { sendError } from '../errors';

export function registerJobRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  app.get('/v1/jobs', async (request, reply) => {
    const query = request.query as { entityId?: string };
    if (!query.entityId) return sendError(reply, 400, 'INVALID_INPUT', 'entityId is required');
    return { jobs: await listJobsForEntity(runtime.db, query.entityId) };
  });
}
