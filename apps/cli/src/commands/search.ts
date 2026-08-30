import { EmbeddingType } from '@memetize/contracts';
import { searchMoments } from '@memetize/retriever';
import type { Command } from 'commander';
import { buildContext } from '../context';

interface SearchOptions {
  type: string;
  limit: string;
}

/** `pnpm cli search "<query>"` (spec sections 28, 74): the Candidate
 * Retriever, exposed read-only through the CLI. No LLM ranks the results. */
export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Semantic search over catalogued moments (Candidate Retriever)')
    .argument('<query>', 'natural language description of what you are looking for')
    .option('--type <type>', `embedding angle to match: ${EmbeddingType.options.join('|')}`, 'MEME')
    .option('--limit <n>', 'maximum number of results', '20')
    .action(async (query: string, options: SearchOptions) => {
      const ctx = await buildContext();
      try {
        const type = EmbeddingType.safeParse(options.type);
        if (!type.success) {
          process.stdout.write(
            `Invalid --type "${options.type}". Expected one of: ${EmbeddingType.options.join(', ')}\n`,
          );
          return;
        }
        const limit = Number.parseInt(options.limit, 10);
        const hits = await searchMoments(ctx.db, ctx.config, {
          query,
          type: type.data,
          limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
        });

        if (hits.length === 0) {
          process.stdout.write('No matches found.\n');
          return;
        }
        for (const hit of hits) {
          process.stdout.write(
            `${hit.momentId}  ${hit.assetId}  ${hit.startMs}..${hit.endMs}  score=${hit.score.toFixed(2)}  ${hit.description}\n`,
          );
        }
      } finally {
        await ctx.close();
      }
    });
}
