import { createAppRuntime } from '@memetize/runtime';
import { buildApi } from './app';

const port = Number.parseInt(process.env.API_PORT ?? '8787', 10);
const runtime = createAppRuntime();
const app = await buildApi(runtime);

// Recover jobs abandoned by a previous crash before serving, then keep doing so
// periodically: the maintenance loop finalizes exhausted leases and drains
// anything runnable — including RUNNING jobs whose lease expired — so a crashed
// attempt is resumed without a new HTTP request or a manual `worker run` (F08).
const reconciled = await runtime.orchestrator.reconcile();
if (reconciled > 0) runtime.logger.warn('startup_reconciled_jobs', { count: reconciled });
const maintenanceMs = Number.parseInt(process.env.JOB_MAINTENANCE_INTERVAL_MS ?? '30000', 10);
runtime.orchestrator.startMaintenance(maintenanceMs);
void runtime.orchestrator.maintenanceTick();

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  // Stop accepting HTTP, stop new claims, let in-flight jobs commit/fail
  // cleanly (their lease still guards the write), then close the pool.
  await app.close();
  await runtime.orchestrator.shutdown();
  await runtime.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '127.0.0.1', port });
runtime.logger.info('api_listening', { port });
