import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase, type Database, type DatabaseHandle } from './client';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Connects to the integration-test database and ensures the schema is applied.
 * Returns null when no test database is configured or reachable, so DB-dependent
 * suites can `describe.skipIf(!handle)` and keep `pnpm test` green without
 * infrastructure. Test files run serially (see vitest.config.ts), so applying
 * migrations here is safe and idempotent.
 *
 * Only TEST_DATABASE_URL is used, never DATABASE_URL, so tests never touch a
 * developer's working database.
 */
export async function createTestDatabase(): Promise<DatabaseHandle | null> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) return null;
  try {
    const handle = createDatabase(url, { max: 4 });
    await handle.sql`select 1`;
    await migrate(handle.db, { migrationsFolder });
    return handle;
  } catch {
    return null;
  }
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table moment_feedback_embeddings, feedback_events, moment_embeddings, moments, transcript_segments, scenes, media_assets, renders, timeline_versions, segment_matches, narrative_segments, lyrics, audio_analysis, project_audio, edit_windows, projects, jobs restart identity cascade`,
  );
}
