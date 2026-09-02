import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { AppRuntime } from '@memetize/runtime';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAssetRoutes } from './routes/assets';
import { registerFeedbackRoutes } from './routes/feedback';
import { registerJobRoutes } from './routes/jobs';
import { registerMediaRoutes } from './routes/media';
import { registerProjectRoutes } from './routes/projects';
import { registerSearchRoutes } from './routes/search';

export async function buildApi(runtime: AppRuntime): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    // @fastify/cors 11 defaults to GET,HEAD,POST; the Studio also issues PUT
    // (manual window) and DELETE (project delete, unban, include range), which
    // browsers preflight.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
  });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

  app.get('/v1/health', async () => ({ ok: true }));

  registerAssetRoutes(app, runtime);
  registerProjectRoutes(app, runtime);
  registerJobRoutes(app, runtime);
  registerSearchRoutes(app, runtime);
  registerFeedbackRoutes(app, runtime);
  registerMediaRoutes(app, runtime);

  return app;
}
