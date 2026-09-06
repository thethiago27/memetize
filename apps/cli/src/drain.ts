import type { CliContext } from './context';

/**
 * Drains an entity's pipeline and reports the first terminal failure.
 *
 * Every `--wait` command needs the same three lines, and each had its own copy
 * — including the same omission: a failed pipeline printed its error and the
 * process still exited 0, so a script could not tell a finished render from a
 * broken one. `process.exitCode` is set here instead; the command still returns
 * so its caller can print whatever detail it was going to print.
 */
export async function drainEntity(ctx: CliContext, entityId: string): Promise<boolean> {
  const outcomes = await ctx.orchestrator.drain({ entityId });
  const failed = outcomes.find((outcome) => outcome.status === 'FAILED');
  if (!failed) return true;

  process.stdout.write(
    `Pipeline failed at ${failed.job.type}: ${failed.error?.code ?? ''} ${failed.error?.message ?? ''}\n`,
  );
  process.exitCode = 1;
  return false;
}
