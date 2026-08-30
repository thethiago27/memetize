import { fileURLToPath } from 'node:url';
import { loadConfig } from '@memetize/shared';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = createDatabase(config.databaseUrl, { max: 1 });
  await migrate(db, { migrationsFolder });
  await close();
  process.stderr.write('migrations applied\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
