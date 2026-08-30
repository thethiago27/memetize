import { exportMoment } from '@memetize/media-catalog';
import type { Command } from 'commander';
import { buildContext } from '../context';

/** `pnpm cli moment export <momentId>` (spec section 75): cuts the moment's
 * clip out of the catalogued proxy/analysis video. Read-only against the
 * catalog and ffmpeg only — no job is enqueued. */
export function registerMomentCommands(program: Command): void {
  const moment = program.command('moment').description('Inspect and export catalogued moments');

  moment
    .command('export')
    .description('Cut a moment out of its asset into storage/temp/{momentId}.mp4')
    .argument('<momentId>', 'moment id (mom_...)')
    .action(async (momentId: string) => {
      const ctx = await buildContext();
      try {
        const output = await exportMoment(ctx.db, ctx.config, momentId);
        process.stdout.write(`Exported ${momentId} -> ${output.relative}\n`);
      } finally {
        await ctx.close();
      }
    });
}
