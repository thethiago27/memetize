import { FEEDBACK_RATING_MAX, FEEDBACK_RATING_MIN } from '@memetize/contracts';
import { listFeedbackEvents } from '@memetize/feedback';
import { addNote, rateClip, rateProject } from '@memetize/projects';
import type { Command } from 'commander';
import { buildContext } from '../context';

/**
 * `pnpm cli feedback ...` (editorial-memory spec): the same helpers the
 * Studio API calls, for scripted or terminal-driven curation.
 */
export function registerFeedbackCommands(program: Command): void {
  const feedback = program.command('feedback').description('Record and inspect editorial feedback');

  feedback
    .command('rate')
    .description(`Rate a project's latest timeline (${FEEDBACK_RATING_MIN}-${FEEDBACK_RATING_MAX})`)
    .argument('<projectId>', 'project id (prj_...)')
    .argument('<value>', 'rating')
    .action(async (projectId: string, rawValue: string) => {
      const value = Number.parseInt(rawValue, 10);
      if (!Number.isInteger(value) || value < FEEDBACK_RATING_MIN || value > FEEDBACK_RATING_MAX) {
        process.stdout.write(
          `Invalid rating "${rawValue}". Expected ${FEEDBACK_RATING_MIN}-${FEEDBACK_RATING_MAX}.\n`,
        );
        return;
      }
      const ctx = await buildContext();
      try {
        const event = await rateProject(ctx.db, { projectId, value });
        process.stdout.write(
          `Rated ${projectId} timeline v${event.timelineVersion} ${value}/5 (${event.id})\n`,
        );
      } finally {
        await ctx.close();
      }
    });

  feedback
    .command('clip')
    .description('Thumbs up or down on a clip of the latest timeline')
    .argument('<projectId>', 'project id (prj_...)')
    .argument('<clipId>', 'clip id (clp_...)')
    .option('--up', 'the clip works')
    .option('--down', 'the clip misses')
    .action(
      async (projectId: string, clipId: string, options: { up?: boolean; down?: boolean }) => {
        if (Boolean(options.up) === Boolean(options.down)) {
          process.stdout.write('Pass exactly one of --up or --down.\n');
          return;
        }
        const ctx = await buildContext();
        try {
          const kind = options.up ? 'CLIP_UP' : 'CLIP_DOWN';
          const event = await rateClip(ctx.db, { projectId, clipId, kind });
          process.stdout.write(`${kind} ${clipId} -> ${event.momentId} (${event.id})\n`);
        } finally {
          await ctx.close();
        }
      },
    );

  feedback
    .command('note')
    .description('Add an editorial note (global unless --project is given)')
    .argument('<text>', 'the note')
    .option('--project <projectId>', 'scope the note to one project')
    .action(async (text: string, options: { project?: string }) => {
      const ctx = await buildContext();
      try {
        const event = await addNote(ctx.db, { projectId: options.project ?? null, note: text });
        process.stdout.write(
          `Noted (${event.id})${options.project ? ` for ${options.project}` : ''}\n`,
        );
      } finally {
        await ctx.close();
      }
    });

  feedback
    .command('list')
    .description('List feedback events, newest first')
    .option('--project <projectId>', 'only this project plus global notes')
    .option('--limit <n>', 'max events', '50')
    .action(async (options: { project?: string; limit: string }) => {
      const ctx = await buildContext();
      try {
        const events = await listFeedbackEvents(ctx.db, {
          ...(options.project ? { projectId: options.project } : {}),
          order: 'desc',
          limit: Number.parseInt(options.limit, 10) || 50,
        });
        if (events.length === 0) {
          process.stdout.write('No feedback yet.\n');
          return;
        }
        for (const event of events) {
          const parts = [
            event.createdAt.toISOString(),
            event.kind.padEnd(12),
            event.projectId ?? '-',
            event.momentId ?? '-',
            event.value != null ? `value=${event.value}` : '',
            event.context.narrativeFunction ? `as ${event.context.narrativeFunction}` : '',
            event.note ? `"${event.note}"` : '',
          ].filter(Boolean);
          process.stdout.write(`${parts.join('  ')}\n`);
        }
      } finally {
        await ctx.close();
      }
    });
}
