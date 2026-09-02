import { banMoment, unbanMoment } from '@memetize/feedback';
import { exportMoment, getMoment } from '@memetize/media-catalog';
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

  moment
    .command('ban')
    .description('Exclude a moment from every future retrieval (editorial memory)')
    .argument('<momentId>', 'moment id (mom_...)')
    .option('--note <text>', 'why')
    .action(async (momentId: string, options: { note?: string }) => {
      const ctx = await buildContext();
      try {
        const row = await getMoment(ctx.db, momentId);
        if (!row) {
          process.stdout.write(`Moment not found: ${momentId}\n`);
          return;
        }
        const event = await banMoment(ctx.db, {
          momentId,
          assetId: row.assetId,
          note: options.note,
        });
        process.stdout.write(`Banned ${momentId} (${event.id})\n`);
      } finally {
        await ctx.close();
      }
    });

  moment
    .command('unban')
    .description('Re-admit a banned moment')
    .argument('<momentId>', 'moment id (mom_...)')
    .action(async (momentId: string) => {
      const ctx = await buildContext();
      try {
        const row = await getMoment(ctx.db, momentId);
        if (!row) {
          process.stdout.write(`Moment not found: ${momentId}\n`);
          return;
        }
        const event = await unbanMoment(ctx.db, { momentId, assetId: row.assetId });
        process.stdout.write(`Unbanned ${momentId} (${event.id})\n`);
      } finally {
        await ctx.close();
      }
    });
}
