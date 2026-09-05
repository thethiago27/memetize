import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase, type Database, type DatabaseHandle } from './client';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Connects to the integration-test database and ensures the schema is applied.
 *
 * Returns null ONLY when the optional test database was not requested, i.e.
 * TEST_DATABASE_URL is unset — so DB-dependent suites can `describe.skipIf(!handle)`
 * and keep `pnpm test` green without infrastructure. Test files run serially
 * (see vitest.config.ts), so applying migrations here is safe and idempotent.
 *
 * When TEST_DATABASE_URL IS set, connection and migration failures are propagated
 * instead of being swallowed into a skip: a misconfigured URL, an unreachable
 * database, or a genuinely broken migration must fail the run, not silently
 * disable the suite (F15). Setting REQUIRE_INTEGRATION_TESTS=1 additionally makes
 * a missing URL a hard error, for CI gates that must exercise the DB-backed cases.
 *
 * Only TEST_DATABASE_URL is used, never DATABASE_URL, so tests never touch a
 * developer's working database.
 */
export async function createTestDatabase(): Promise<DatabaseHandle | null> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) {
    if (process.env.REQUIRE_INTEGRATION_TESTS === '1') {
      throw new Error('TEST_DATABASE_URL is required when REQUIRE_INTEGRATION_TESTS=1');
    }
    return null;
  }

  const handle = createDatabase(url, { max: 4 });
  try {
    await handle.sql`select 1`;
    await migrate(handle.db, { migrationsFolder });
    return handle;
  } catch (error) {
    // Preserve the original failure; close best-effort without masking it.
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table moment_feedback_embeddings, feedback_events, moment_embeddings, moments, transcript_segments, scenes, media_assets, renders, timeline_versions, segment_matches, narrative_segments, lyrics, audio_analysis, project_audio, edit_windows, projects, jobs restart identity cascade`,
  );
}
