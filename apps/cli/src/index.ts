import { Command } from 'commander';
import { registerAssetCommands } from './commands/asset';
import { registerEvalCommands } from './commands/eval';
import { registerFeedbackCommands } from './commands/feedback';
import { registerJobCommands } from './commands/job';
import { registerMomentCommands } from './commands/moment';
import { registerProjectCommands } from './commands/project';
import { registerSearchCommand } from './commands/search';
import { registerWorkerCommands } from './commands/worker';

const program = new Command();

program
  .name('memetize')
  .description('AI meme video editor - local catalog pipeline CLI')
  .version('0.0.0');

registerAssetCommands(program);
registerEvalCommands(program);
registerFeedbackCommands(program);
registerJobCommands(program);
registerMomentCommands(program);
registerProjectCommands(program);
registerSearchCommand(program);
registerWorkerCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
