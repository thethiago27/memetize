import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { evaluateRanker, loadRankerCases } from '@memetize/evaluation';
import { evalReportFile } from '@memetize/projects';
import { ensureDir } from '@memetize/shared';
import type { Command } from 'commander';
import { buildContext } from '../context';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * `pnpm cli eval ranker` (editorial-memory spec): replays every recorded
 * editorial decision against the current ranker, using only the feedback
 * that existed before each one, and reports how often the editor's pick
 * would have ranked first.
 */
export function registerEvalCommands(program: Command): void {
  const evaluate = program
    .command('eval')
    .description('Measure the motor against editorial memory');

  evaluate
    .command('ranker')
    .description('Replay swaps and thumbs-down against the current clip ranker')
    .option('--json', 'print the full report as JSON')
    .action(async (options: { json?: boolean }) => {
      const ctx = await buildContext();
      try {
        const dataset = await loadRankerCases(ctx.db);
        const result = evaluateRanker(dataset);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const report = evalReportFile(ctx.config, `ranker-${stamp}`);
        await ensureDir(dirname(report.absolute));
        await writeFile(
          report.absolute,
          JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2),
        );

        if (options.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        if (result.caseCount === 0) {
          process.stdout.write('No editorial decisions to replay yet. Swap or rate clips first.\n');
          return;
        }
        const lines = [
          `Ranker evaluation  (${result.caseCount} cases, ${result.skipped} skipped)`,
          `  chosen   n=${result.chosen.count}  top1=${pct(result.chosen.top1)}  top3=${pct(result.chosen.top3)}  mrr=${result.chosen.mrr.toFixed(3)}`,
          `  rejected n=${result.rejected.count}  still first=${pct(result.rejected.stillTop1)}`,
          `  report:  ${report.relative}`,
        ];
        process.stdout.write(`${lines.join('\n')}\n`);
      } finally {
        await ctx.close();
      }
    });
}
