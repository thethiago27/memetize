import { createAppRuntime } from '@memetize/runtime';
import { buildApi } from './app';

const port = Number.parseInt(process.env.API_PORT ?? '8787', 10);
const runtime = createAppRuntime();
const app = await buildApi(runtime);

const shutdown = async () => {
  await app.close();
  await runtime.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '127.0.0.1', port });
runtime.logger.info('api_listening', { port });
