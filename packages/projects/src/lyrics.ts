import type { LyricLine, LyricSource } from '@memetize/contracts';
import { type Executor, type LyricsRow, lyrics, type NewLyricsRow } from '@memetize/database';
import { assertIntegerMs, lyricsId } from '@memetize/shared';
import { and, desc, eq } from 'drizzle-orm';

export interface ReplaceLyricsParams {
  projectId: string;
  source: LyricSource;
  lines: LyricLine[];
  model: string;
  modelVersion: string;
}

/** Pure builder: enforces integer milliseconds (spec section 4.4). */
export function toLyricsRow(params: ReplaceLyricsParams): NewLyricsRow {
  return {
    id: lyricsId(),
    projectId: params.projectId,
    source: params.source,
    lines: params.lines.map((line) => ({
      ...line,
      startMs: assertIntegerMs(line.startMs, 'startMs'),
      endMs: assertIntegerMs(line.endMs, 'endMs'),
      words: line.words.map((word) => ({
        ...word,
        startMs: assertIntegerMs(word.startMs, 'startMs'),
        endMs: assertIntegerMs(word.endMs, 'endMs'),
      })),
    })),
    model: params.model,
    modelVersion: params.modelVersion,
  };
}

/**
 * Idempotently persists lyrics: existing rows for that exact
 * project/source/model/version combination are replaced (spec section 4.2).
 * An empty line list (instrumental) is a valid, successful result.
 */
export async function replaceLyrics(db: Executor, params: ReplaceLyricsParams): Promise<LyricsRow> {
  const row = toLyricsRow(params);
  return db.transaction(async (tx) => {
    await tx
      .delete(lyrics)
      .where(
        and(
          eq(lyrics.projectId, params.projectId),
          eq(lyrics.source, params.source),
          eq(lyrics.model, params.model),
          eq(lyrics.modelVersion, params.modelVersion),
        ),
      );
    const inserted = await tx.insert(lyrics).values(row).returning();
    const persisted = inserted[0];
    if (!persisted) throw new Error('failed to insert lyrics');
    return persisted;
  });
}

/** Most recent lyrics for a project (spec section 39). */
export function getLyrics(db: Executor, projectId: string): Promise<LyricsRow | undefined> {
  return db.query.lyrics.findFirst({
    where: eq(lyrics.projectId, projectId),
    orderBy: desc(lyrics.createdAt),
  });
}
