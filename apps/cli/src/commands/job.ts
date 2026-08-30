import { JobType } from '@memetize/contracts';
import { enqueueJob } from '@memetize/job-system';
import type { Command } from 'commander';
import { buildContext } from '../context';

interface EnqueueOptions {
  type: string;
  entityId: string;
  input: string;
}

export function registerJobCommands(program: Command): void {
  const job = program.command('job').description('Inspect and enqueue jobs');

  job
    .command('enqueue')
    .description('Enqueue a job (idempotent on type + entity + input + worker version)')
    .requiredOption('--type <type>', 'job type (PING, VIDEO_NORMALIZE, SCENE_DETECT)')
    .requiredOption('--entity-id <id>', 'entity id the job operates on')
    .option('--input <json>', 'JSON input payload', '{}')
    .action(async (options: EnqueueOptions) => {
      const ctx = await buildContext();
      try {
        const parsedType = JobType.safeParse(options.type);
        if (!parsedType.success) {
          throw new Error(`unknown job type: ${options.type}`);
        }
        const input = JSON.parse(options.input) as Record<string, unknown>;
        const { job: row, created } = await enqueueJob(ctx.db, {
          type: parsedType.data,
          entityId: options.entityId,
          input,
        });
        process.stdout.write(
          `${created ? 'Enqueued' : 'Existing'} job ${row.id} (${row.type}) status=${row.status}\n`,
        );
      } finally {
        await ctx.close();
      }
    });
}
