import type { Command } from 'commander';
import { buildContext } from '../context';

interface RunOptions {
  once?: boolean;
  entity?: string;
}

export function registerWorkerCommands(program: Command): void {
  const worker = program.command('worker').description('Process jobs from the queue');

  worker
    .command('run')
    .description('Process pending jobs (all by default, or a single one with --once)')
    .option('--once', 'process a single job and exit')
    .option('--entity <id>', 'only process jobs for this entity')
    .action(async (options: RunOptions) => {
      const ctx = await buildContext();
      try {
        if (options.once) {
          const outcome = await ctx.orchestrator.runOnce({ entityId: options.entity });
          if (!outcome) {
            process.stdout.write('No pending jobs.\n');
          } else {
            process.stdout.write(
              `Job ${outcome.job.id} (${outcome.job.type}) -> ${outcome.status}\n`,
            );
          }
        } else {
          const outcomes = await ctx.orchestrator.drain({ entityId: options.entity });
          process.stdout.write(`Processed ${outcomes.length} job(s).\n`);
          for (const outcome of outcomes) {
            process.stdout.write(`  ${outcome.job.type} -> ${outcome.status}\n`);
          }
        }
      } finally {
        await ctx.close();
      }
    });
}
