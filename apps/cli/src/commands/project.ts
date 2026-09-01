import { resolve } from 'node:path';
import type { RenderWarning } from '@memetize/contracts';
import {
  generateTimeline,
  getAudioAnalysis,
  getLatestEditWindow,
  getLatestRender,
  getLatestTimeline,
  getLyrics,
  getProject,
  getProjectAudio,
  ingestProject,
  listNarrativeSegments,
  listProjects,
  listSegmentMatches,
  REPROCESS_STAGES,
  type ReprocessStage,
  renderProject,
  reprocessProject,
} from '@memetize/projects';
import type { TimelineEffect } from '@memetize/timeline';
import type { Command } from 'commander';
import { buildContext, type CliContext } from '../context';

interface CreateOptions {
  wait: boolean;
  lyrics?: string;
}

export function registerProjectCommands(program: Command): void {
  const project = program.command('project').description('Manage music projects');

  project
    .command('create')
    .description(
      'Ingest a song and run the music pipeline (audio analysis + lyrics + narrative + matching + director)',
    )
    .argument('<file>', 'path to an audio file')
    .option('--lyrics <file>', 'path to a .lrc or .txt lyrics file')
    .option('--no-wait', 'enqueue only; do not drain the pipeline')
    .action(async (file: string, options: CreateOptions) => {
      const ctx = await buildContext();
      try {
        const filePath = resolve(process.cwd(), file);
        const lyricsPath = options.lyrics ? resolve(process.cwd(), options.lyrics) : undefined;
        const { project: row } = await ingestProject({
          db: ctx.db,
          config: ctx.config,
          filePath,
          lyricsPath,
        });

        process.stdout.write(`Ingested ${row.filename} as ${row.id}\n`);

        if (options.wait) {
          const outcomes = await ctx.orchestrator.drain({ entityId: row.id });
          const failed = outcomes.find((outcome) => outcome.status === 'FAILED');
          if (failed) {
            process.stdout.write(
              `Pipeline failed at ${failed.job.type}: ${failed.error?.code ?? ''} ${failed.error?.message ?? ''}\n`,
            );
          }
          await printProjectDetails(ctx, row.id);
        } else {
          process.stdout.write(
            "Enqueued audio analysis + lyrics. Run 'memetize worker run' to process.\n",
          );
        }
      } finally {
        await ctx.close();
      }
    });

  project
    .command('list')
    .description('List music projects')
    .action(async () => {
      const ctx = await buildContext();
      try {
        const projects = await listProjects(ctx.db);
        if (projects.length === 0) {
          process.stdout.write('No projects yet. Add one with: memetize project create <file>\n');
          return;
        }
        for (const row of projects) {
          const audio = await getAudioAnalysis(ctx.db, row.id);
          const lyrics = await getLyrics(ctx.db, row.id);
          const narrative = await listNarrativeSegments(ctx.db, row.id);
          const matches = await listSegmentMatches(ctx.db, row.id);
          const timeline = await getLatestTimeline(ctx.db, row.id);
          const render = await getLatestRender(ctx.db, row.id);
          const duration = audio ? `${(audio.durationMs / 1000).toFixed(1)}s` : '-';
          const sectionCount = audio?.sections.length ?? 0;
          const timelineLabel = timeline ? `timeline v${timeline.version}` : 'no timeline';
          const renderLabel = render ? `render v${render.version}` : 'no render';
          process.stdout.write(
            `${row.id}  ${row.status.padEnd(15)}  ${duration.padStart(6)}  ${String(sectionCount).padStart(2)} sections  ${String(lyrics?.lines.length ?? 0).padStart(3)} lyrics  ${String(narrative.length).padStart(3)} narrative  ${String(matches.length).padStart(3)} matched  ${timelineLabel.padEnd(12)}  ${renderLabel.padEnd(10)}  ${row.filename}\n`,
          );
        }
      } finally {
        await ctx.close();
      }
    });

  project
    .command('generate')
    .description('Force a fresh Director run for a project, creating a new timeline version')
    .argument('<projectId>', 'project id (prj_...)')
    .option('--no-wait', 'enqueue only; do not drain the pipeline')
    .action(async (projectId: string, options: { wait: boolean }) => {
      const ctx = await buildContext();
      try {
        await generateTimeline(ctx.db, projectId);
        process.stdout.write(`Enqueued a new DIRECTOR run for ${projectId}...\n`);

        if (options.wait) {
          const outcomes = await ctx.orchestrator.drain({ entityId: projectId });
          const failed = outcomes.find((outcome) => outcome.status === 'FAILED');
          if (failed) {
            process.stdout.write(
              `Pipeline failed at ${failed.job.type}: ${failed.error?.code ?? ''} ${failed.error?.message ?? ''}\n`,
            );
          }
          await printProjectDetails(ctx, projectId);
        } else {
          process.stdout.write("Run 'memetize worker run' to process.\n");
        }
      } finally {
        await ctx.close();
      }
    });

  project
    .command('render')
    .description('Render the latest timeline into an MP4 (spec section 55: the first MVP video)')
    .argument('<projectId>', 'project id (prj_...)')
    .option('--no-wait', 'enqueue only; do not drain the pipeline')
    .action(async (projectId: string, options: { wait: boolean }) => {
      const ctx = await buildContext();
      try {
        await renderProject(ctx.db, projectId);
        process.stdout.write(`Enqueued a new RENDER run for ${projectId}...\n`);

        if (options.wait) {
          const outcomes = await ctx.orchestrator.drain({ entityId: projectId });
          const failed = outcomes.find((outcome) => outcome.status === 'FAILED');
          if (failed) {
            process.stdout.write(
              `Pipeline failed at ${failed.job.type}: ${failed.error?.code ?? ''} ${failed.error?.message ?? ''}\n`,
            );
          }
          await printProjectDetails(ctx, projectId);
        } else {
          process.stdout.write("Run 'memetize worker run' to process.\n");
        }
      } finally {
        await ctx.close();
      }
    });

  project
    .command('inspect')
    .description('Show a project with its audio, lyrics, and narrative timelines')
    .argument('<projectId>', 'project id (prj_...)')
    .action(async (projectId: string) => {
      const ctx = await buildContext();
      try {
        await printProjectDetails(ctx, projectId);
      } finally {
        await ctx.close();
      }
    });

  project
    .command('reprocess')
    .description('Re-run the music pipeline for a project from a given stage onward')
    .argument('<projectId>', 'project id (prj_...)')
    .requiredOption('--from <stage>', `stage to restart from: ${REPROCESS_STAGES.join('|')}`)
    .option('--no-wait', 'enqueue only; do not drain the pipeline')
    .action(async (projectId: string, options: { from: string; wait: boolean }) => {
      const ctx = await buildContext();
      try {
        if (!isReprocessStage(options.from)) {
          process.stdout.write(
            `Invalid --from "${options.from}". Expected one of: ${REPROCESS_STAGES.join(', ')}\n`,
          );
          return;
        }
        await reprocessProject(ctx.db, projectId, options.from);
        process.stdout.write(`Reprocessing ${projectId} from ${options.from}...\n`);

        if (options.wait) {
          const outcomes = await ctx.orchestrator.drain({ entityId: projectId });
          const failed = outcomes.find((outcome) => outcome.status === 'FAILED');
          if (failed) {
            process.stdout.write(
              `Pipeline failed at ${failed.job.type}: ${failed.error?.code ?? ''} ${failed.error?.message ?? ''}\n`,
            );
          }
          await printProjectDetails(ctx, projectId);
        } else {
          process.stdout.write("Run 'memetize worker run' to process.\n");
        }
      } finally {
        await ctx.close();
      }
    });
}

function isReprocessStage(value: string): value is ReprocessStage {
  return (REPROCESS_STAGES as readonly string[]).includes(value);
}

async function printProjectDetails(ctx: CliContext, id: string): Promise<void> {
  const row = await getProject(ctx.db, id);
  if (!row) {
    process.stdout.write(`Project not found: ${id}\n`);
    return;
  }
  const audioFile = await getProjectAudio(ctx.db, id);
  const audio = await getAudioAnalysis(ctx.db, id);
  const editWindow = await getLatestEditWindow(ctx.db, id);
  const lyrics = await getLyrics(ctx.db, id);
  const narrative = await listNarrativeSegments(ctx.db, id);
  const matches = await listSegmentMatches(ctx.db, id);
  const matchBySegment = new Map(matches.map((match) => [match.segmentId, match]));
  const timeline = await getLatestTimeline(ctx.db, id);
  const render = await getLatestRender(ctx.db, id);

  const lines = [
    `Project ${row.id}`,
    `  filename: ${row.filename}`,
    `  status:   ${row.status}`,
    `  original: ${audioFile?.originalPath ?? '-'}`,
    `  duration: ${audioFile?.durationMs ?? '-'} ms`,
  ];

  if (audio) {
    lines.push(
      `  audio:    bpm=${audio.bpm}  ${audio.beats.length} beats  ${audio.downbeats.length} downbeats  ${audio.sections.length} sections  ${audio.energyCurve.length} energy points`,
    );
    for (const section of audio.sections) {
      lines.push(`    ${section.type.padEnd(8)} ${section.startMs}..${section.endMs} ms`);
    }
  } else {
    lines.push('  audio:    (not analyzed yet)');
  }

  if (editWindow) {
    lines.push(
      `  window:   ${editWindow.sourceStartMs}..${editWindow.sourceEndMs} ms  output=${editWindow.durationMs} ms  ${editWindow.selector} v${editWindow.selectorVersion}  score=${editWindow.score.toFixed(3)}`,
    );
  } else {
    lines.push('  window:   (not selected yet)');
  }

  if (lyrics) {
    lines.push(
      `  lyrics:   source=${lyrics.source}  ${lyrics.lines.length === 0 ? '(instrumental)' : `${lyrics.lines.length} lines`}  lrc=${ctx.config.storageDirRelative}/audio/${id}/lyrics.lrc`,
    );
    for (const line of lyrics.lines) {
      lines.push(`    ${line.startMs}..${line.endMs} ms  "${line.text}"`);
    }
  } else {
    lines.push('  lyrics:   (not processed yet)');
  }

  lines.push(`  narrative: ${narrative.length} segments`);
  for (const segment of narrative) {
    lines.push(
      `    ${segment.id}  ${segment.startMs}..${segment.endMs} ms  ${segment.narrativeFunction}  ${segment.meaning}  visualIdeas=[${segment.visualIdeas.join(', ')}]`,
    );
    const match = matchBySegment.get(segment.id);
    if (match && match.shortlist.length > 0) {
      lines.push('      shortlist:');
      match.shortlist.forEach((entry, index) => {
        lines.push(
          `        ${index + 1}. ${entry.momentId}  ${entry.assetId}  final=${entry.finalScore.toFixed(2)}  penalties=[${entry.penalties.join(', ')}]`,
        );
      });
    } else if (match) {
      lines.push('      shortlist: (empty — catalog has no candidates)');
    }
  }

  if (timeline) {
    const { canvas } = timeline.data;
    lines.push(
      `  timeline: v${timeline.version}  ${timeline.data.clips.length} clips  ${canvas.width}x${canvas.height}@${canvas.fps}`,
    );
    timeline.data.clips.forEach((clip, index) => {
      const effectsLabel = formatClipEffects(clip.effects);
      lines.push(
        `    ${index + 1}. ${clip.id}  ${clip.timeline.startMs}..${clip.timeline.endMs}  ${clip.momentId}  ${clip.source.assetId}  source ${clip.source.startMs}..${clip.source.endMs}  final=${clip.reason.finalScore.toFixed(2)}${effectsLabel}`,
      );
    });
  } else {
    lines.push('  timeline: (not generated yet)');
  }

  if (render) {
    lines.push(
      `  render:   v${render.version}  ${render.path}  ${render.width}x${render.height}@${render.fps}  ${render.videoCodec}/${render.audioCodec}  ${render.validation.warnings.length} warnings`,
    );
    for (const warning of render.validation.warnings) {
      lines.push(`    ${formatRenderWarning(warning)}`);
    }
  } else {
    lines.push('  render:   (not rendered yet)');
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

function formatClipEffects(effects: readonly TimelineEffect[]): string {
  if (effects.length === 0) return '';
  return effects
    .map((effect) => {
      if (effect.type === 'zoom') {
        const from = typeof effect.from === 'number' ? effect.from : '?';
        const to = typeof effect.to === 'number' ? effect.to : '?';
        return `  zoom ${effect.startMs}..${effect.endMs} ${from}→${to}`;
      }
      return `  ${effect.type} ${effect.startMs}..${effect.endMs}`;
    })
    .join('');
}

function formatRenderWarning(warning: RenderWarning): string {
  const parts = [warning.code.padEnd(24)];
  if (warning.clipId) parts.push(warning.clipId);
  if (warning.startMs !== undefined && warning.endMs !== undefined) {
    parts.push(`${warning.startMs}..${warning.endMs}`);
  }
  if (warning.durationMs !== undefined) parts.push(`${warning.durationMs}ms`);
  if (warning.message) parts.push(warning.message);
  return parts.join('  ');
}
