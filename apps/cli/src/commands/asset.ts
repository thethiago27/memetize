import { resolve } from 'node:path';
import { banAsset, unbanAsset } from '@memetize/feedback';
import {
  getAsset,
  ingestAsset,
  listAssets,
  listEmbeddingsForAsset,
  listMoments,
  listScenes,
  listTranscriptSegments,
  REPROCESS_STAGES,
  type ReprocessStage,
  reprocessAsset,
} from '@memetize/media-catalog';
import type { Command } from 'commander';
import { buildContext, type CliContext } from '../context';

interface AddOptions {
  wait: boolean;
  source?: string;
}

export function registerAssetCommands(program: Command): void {
  const asset = program.command('asset').description('Manage media assets');

  asset
    .command('add')
    .description('Ingest a video and run the catalog pipeline (normalize + scene detect)')
    .argument('<file>', 'path to a video file')
    .option('--no-wait', 'enqueue only; do not drain the pipeline')
    .option('--source <source>', 'provenance note stored with the asset')
    .action(async (file: string, options: AddOptions) => {
      const ctx = await buildContext();
      try {
        const filePath = resolve(process.cwd(), file);
        const { asset: row, created } = await ingestAsset({
          db: ctx.db,
          config: ctx.config,
          filePath,
          source: options.source,
        });

        process.stdout.write(
          created
            ? `Ingested ${row.filename} as ${row.id}\n`
            : `Asset already exists (dedup by checksum): ${row.id}\n`,
        );

        if (options.wait) {
          const outcomes = await ctx.orchestrator.drain({ entityId: row.id });
          const failed = outcomes.find((outcome) => outcome.status === 'FAILED');
          if (failed) {
            process.stdout.write(
              `Pipeline failed at ${failed.job.type}: ${failed.error?.code ?? ''} ${failed.error?.message ?? ''}\n`,
            );
          }
          await printAssetDetails(ctx, row.id);
        } else {
          process.stdout.write("Enqueued normalization. Run 'memetize worker run' to process.\n");
        }
      } finally {
        await ctx.close();
      }
    });

  asset
    .command('list')
    .description('List catalogued assets')
    .action(async () => {
      const ctx = await buildContext();
      try {
        const assets = await listAssets(ctx.db);
        if (assets.length === 0) {
          process.stdout.write('No assets yet. Add one with: memetize asset add <file>\n');
          return;
        }
        for (const row of assets) {
          const scenes = await listScenes(ctx.db, row.id);
          const moments = await listMoments(ctx.db, row.id);
          const duration = row.durationMs != null ? `${(row.durationMs / 1000).toFixed(1)}s` : '-';
          process.stdout.write(
            `${row.id}  ${row.status.padEnd(11)}  ${duration.padStart(6)}  ${String(scenes.length).padStart(3)} scenes  ${String(moments.length).padStart(3)} moments  ${row.filename}\n`,
          );
        }
      } finally {
        await ctx.close();
      }
    });

  asset
    .command('inspect')
    .description('Show an asset with its derived files, scenes, transcript, and moments')
    .argument('<assetId>', 'asset id (ast_...)')
    .action(async (assetId: string) => {
      const ctx = await buildContext();
      try {
        await printAssetDetails(ctx, assetId);
      } finally {
        await ctx.close();
      }
    });

  asset
    .command('reprocess')
    .description('Re-run the pipeline for an asset from a given stage onward')
    .argument('<assetId>', 'asset id (ast_...)')
    .requiredOption('--from <stage>', `stage to restart from: ${REPROCESS_STAGES.join('|')}`)
    .option('--no-wait', 'enqueue only; do not drain the pipeline')
    .action(async (assetId: string, options: { from: string; wait: boolean }) => {
      const ctx = await buildContext();
      try {
        if (!isReprocessStage(options.from)) {
          process.stdout.write(
            `Invalid --from "${options.from}". Expected one of: ${REPROCESS_STAGES.join(', ')}\n`,
          );
          return;
        }
        await reprocessAsset(ctx.db, assetId, options.from);
        process.stdout.write(`Reprocessing ${assetId} from ${options.from}...\n`);

        if (options.wait) {
          const outcomes = await ctx.orchestrator.drain({ entityId: assetId });
          const failed = outcomes.find((outcome) => outcome.status === 'FAILED');
          if (failed) {
            process.stdout.write(
              `Pipeline failed at ${failed.job.type}: ${failed.error?.code ?? ''} ${failed.error?.message ?? ''}\n`,
            );
          }
          await printAssetDetails(ctx, assetId);
        } else {
          process.stdout.write("Run 'memetize worker run' to process.\n");
        }
      } finally {
        await ctx.close();
      }
    });

  asset
    .command('ban')
    .description('Exclude every moment of an asset from future retrieval (editorial memory)')
    .argument('<assetId>', 'asset id (ast_...)')
    .option('--note <text>', 'why')
    .action(async (assetId: string, options: { note?: string }) => {
      const ctx = await buildContext();
      try {
        if (!(await getAsset(ctx.db, assetId))) {
          process.stdout.write(`Asset not found: ${assetId}\n`);
          return;
        }
        const event = await banAsset(ctx.db, { assetId, note: options.note });
        process.stdout.write(`Banned ${assetId} (${event.id})\n`);
      } finally {
        await ctx.close();
      }
    });

  asset
    .command('unban')
    .description('Re-admit a banned asset')
    .argument('<assetId>', 'asset id (ast_...)')
    .action(async (assetId: string) => {
      const ctx = await buildContext();
      try {
        if (!(await getAsset(ctx.db, assetId))) {
          process.stdout.write(`Asset not found: ${assetId}\n`);
          return;
        }
        const event = await unbanAsset(ctx.db, { assetId });
        process.stdout.write(`Unbanned ${assetId} (${event.id})\n`);
      } finally {
        await ctx.close();
      }
    });
}

function isReprocessStage(value: string): value is ReprocessStage {
  return (REPROCESS_STAGES as readonly string[]).includes(value);
}

async function printAssetDetails(ctx: CliContext, id: string): Promise<void> {
  const row = await getAsset(ctx.db, id);
  if (!row) {
    process.stdout.write(`Asset not found: ${id}\n`);
    return;
  }
  const scenes = await listScenes(ctx.db, id);
  const transcript = await listTranscriptSegments(ctx.db, id);
  const moments = await listMoments(ctx.db, id);
  const embeddings = await listEmbeddingsForAsset(ctx.db, id);

  const lines = [
    `Asset ${row.id}`,
    `  filename:   ${row.filename}`,
    `  status:     ${row.status}`,
    `  duration:   ${row.durationMs ?? '-'} ms`,
    `  resolution: ${row.width ?? '-'}x${row.height ?? '-'}`,
    `  fps:        ${row.fpsMilli ? (row.fpsMilli / 1000).toFixed(3) : '-'}`,
    `  size:       ${row.sizeBytes ?? '-'} bytes`,
    `  original:   ${row.originalPath}`,
    `  proxy:      ${row.proxyPath ?? '-'}`,
    `  analysis:   ${row.analysisPath ?? '-'}`,
    `  thumbnail:  ${row.thumbnailPath ?? '-'}`,
    `  scenes:     ${scenes.length}`,
  ];
  for (const scene of scenes) {
    const summary = scene.vision?.summary ?? '(no vision yet)';
    lines.push(
      `    ${scene.id}  ${scene.startMs}..${scene.endMs} ms  (${scene.durationMs} ms)  ${scene.frames.length} frames  ${summary}`,
    );
  }

  lines.push(
    `  transcript: ${transcript.length === 0 ? '(none)' : `${transcript.length} segments`}`,
  );
  for (const segment of transcript) {
    lines.push(`    ${segment.startMs}..${segment.endMs} ms  "${segment.text}"`);
  }

  lines.push(`  moments:    ${moments.length}`);
  for (const moment of moments) {
    lines.push(`    ${moment.id}  ${moment.startMs}..${moment.endMs} ms  ${moment.description}`);
  }

  lines.push(`  embeddings: ${embeddings.length} (expected ${moments.length * 3})`);

  process.stdout.write(`${lines.join('\n')}\n`);
}
