import type { SubtitleLine } from '@memetize/contracts';
import {
  type Executor,
  type NewSubtitlesRow,
  type SubtitlesRow,
  subtitles,
} from '@memetize/database';
import { assertIntegerMs, subtitlesId } from '@memetize/shared';
import { desc, eq } from 'drizzle-orm';

export interface ReplaceSubtitlesParams {
  projectId: string;
  language: string;
  sourceLanguage: string | null;
  translated: boolean;
  lines: SubtitleLine[];
  model: string;
  modelVersion: string;
}

/** Pure builder: enforces integer milliseconds (spec section 4.4). */
export function toSubtitlesRow(params: ReplaceSubtitlesParams): NewSubtitlesRow {
  return {
    id: subtitlesId(),
    projectId: params.projectId,
    language: params.language,
    sourceLanguage: params.sourceLanguage,
    translated: params.translated,
    lines: params.lines.map((line) => ({
      startMs: assertIntegerMs(line.startMs, 'startMs'),
      endMs: assertIntegerMs(line.endMs, 'endMs'),
      text: line.text,
    })),
    model: params.model,
    modelVersion: params.modelVersion,
  };
}

/**
 * A project has exactly one current subtitles row (translated-subtitles spec):
 * every existing row for that project is deleted, then the new one is inserted.
 */
export async function replaceSubtitles(
  db: Executor,
  params: ReplaceSubtitlesParams,
): Promise<SubtitlesRow> {
  const row = toSubtitlesRow(params);
  return db.transaction(async (tx) => {
    await tx.delete(subtitles).where(eq(subtitles.projectId, params.projectId));
    const inserted = await tx.insert(subtitles).values(row).returning();
    const persisted = inserted[0];
    if (!persisted) throw new Error('failed to insert subtitles');
    return persisted;
  });
}

/** Current (most recent) subtitles row for a project. */
export function getSubtitles(db: Executor, projectId: string): Promise<SubtitlesRow | undefined> {
  return db.query.subtitles.findFirst({
    where: eq(subtitles.projectId, projectId),
    orderBy: desc(subtitles.createdAt),
  });
}
