import type { MomentForRanking } from '@memetize/clip-ranker';
import { type Database, moments as momentsTable } from '@memetize/database';
import { type FeedbackEventLike, listFeedbackEvents } from '@memetize/feedback';
import { inArray } from 'drizzle-orm';
import { buildRankerCases, type RankerCase } from './cases';

export interface RankerDataset {
  cases: RankerCase[];
  events: FeedbackEventLike[];
  moments: Map<string, MomentForRanking>;
}

/** Everything `evaluateRanker` needs, read once from the database. */
export async function loadRankerCases(db: Database): Promise<RankerDataset> {
  const events = await listFeedbackEvents(db);
  const cases = buildRankerCases(events);
  const momentIds = new Set<string>();
  for (const testCase of cases) {
    for (const candidate of testCase.candidates) momentIds.add(candidate.momentId);
  }
  const rows =
    momentIds.size > 0
      ? await db.query.moments.findMany({ where: inArray(momentsTable.id, [...momentIds]) })
      : [];
  const moments = new Map<string, MomentForRanking>(
    rows.map((row) => [
      row.id,
      {
        durationMs: row.durationMs,
        primaryEmotion: row.primaryEmotion,
        visualEnergy: row.visualEnergy,
        qualityScore: row.qualityScore,
        metadata: row.metadata,
      },
    ]),
  );
  return { cases, events, moments };
}
