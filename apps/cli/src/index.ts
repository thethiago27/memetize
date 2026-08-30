import { Command } from 'commander';
import { registerAssetCommands } from './commands/asset';
import { registerJobCommands } from './commands/job';
import { registerMomentCommands } from './commands/moment';
import { registerSearchCommand } from './commands/search';
import { registerWorkerCommands } from './commands/worker';

const program = new Command();

program
  .name('memetize')
  .description('AI meme video editor - local catalog pipeline CLI')
  .version('0.0.0');

registerAssetCommands(program);
registerJobCommands(program);
registerMomentCommands(program);
registerSearchCommand(program);
registerWorkerCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
