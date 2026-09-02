import { RETRIEVE_LIMIT, type RetrievedCandidate } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import type { AppConfig } from '@memetize/shared';
import { searchFeedbackMoments } from './feedback-search';
import { embedQuery, type SearchExclusions, searchMomentsByVector } from './search';

/**
 * The minimal shape of a narrative segment the retriever needs (spec section
 * 27): kept structural rather than importing `NarrativeSegmentRow` so this
 * package doesn't take on a dependency on `@memetize/projects`.
 */
export interface SegmentForRetrieval {
  visualIdeas: string[];
  emotion: string;
  narrativeFunction: string;
}

export interface RetrieveForSegmentParams {
  limit?: number;
  /** Active bans (editorial-memory spec): filtered in SQL on every index. */
  exclude?: SearchExclusions;
  /** Moments the editor swapped out of this very segment: never offered again. */
  rejectedMomentIds?: ReadonlySet<string>;
}

/**
 * One query per `visualIdea` (spec section 28: the Narrative Analyzer's
 * queries, not an LLM, drives retrieval). Falls back to the segment's
 * emotion/narrative function, then to a generic query, so a segment never
 * retrieves zero candidates just because `visualIdeas` came back empty.
 */
function buildQueries(segment: SegmentForRetrieval): string[] {
  const ideas = segment.visualIdeas.map((idea) => idea.trim()).filter(Boolean);
  if (ideas.length > 0) return ideas;

  const fallback = [segment.emotion, segment.narrativeFunction]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return fallback.length > 0 ? fallback : ['reaction'];
}

/**
 * Candidate Retriever fan-out for a single narrative segment (spec section
 * 28, editorial-memory spec): per query, searches the catalog index and the
 * POSITIVE feedback index, unions by `momentId` keeping each moment's best
 * score and the index that produced it, drops moments rejected from this
 * segment, then marks candidates whose NEGATIVE feedback vectors resemble
 * the query so the ranker can damp them.
 */
export async function retrieveForSegment(
  db: Database,
  config: AppConfig,
  segment: SegmentForRetrieval,
  params: RetrieveForSegmentParams = {},
): Promise<RetrievedCandidate[]> {
  const limit = params.limit ?? RETRIEVE_LIMIT;
  const queries = buildQueries(segment);
  const exclude = params.exclude;

  const byMoment = new Map<string, RetrievedCandidate>();
  const negativeByMoment = new Map<string, number>();

  for (const text of queries) {
    const query = await embedQuery(config, text);
    const [catalogHits, positiveHits, negativeHits] = await Promise.all([
      searchMomentsByVector(db, { query, type: 'MEME', limit, exclude }),
      searchFeedbackMoments(db, { query, polarity: 'POSITIVE', limit, exclude }),
      searchFeedbackMoments(db, { query, polarity: 'NEGATIVE', limit, exclude }),
    ]);

    const merged = [
      ...catalogHits.map((hit) => ({ ...hit, source: 'CATALOG' as const })),
      ...positiveHits.map((hit) => ({ ...hit, source: 'FEEDBACK' as const })),
    ];
    for (const hit of merged) {
      // Cosine similarity (spec section 28's `score = 1 - distance`) can dip
      // below 0 for unrelated vectors; clamp so every layer of the funnel
      // stays in the same [0, 1] range the contracts declare.
      const semanticScore = Math.max(0, Math.min(1, hit.score));
      const existing = byMoment.get(hit.momentId);
      if (!existing || semanticScore > existing.semanticScore) {
        byMoment.set(hit.momentId, {
          momentId: hit.momentId,
          assetId: hit.assetId,
          semanticScore,
          source: hit.source,
          negativeScore: 0,
        });
      }
    }
    for (const hit of negativeHits) {
      const current = negativeByMoment.get(hit.momentId) ?? 0;
      if (hit.score > current) negativeByMoment.set(hit.momentId, hit.score);
    }
  }

  const rejected = params.rejectedMomentIds;
  return Array.from(byMoment.values())
    .filter((candidate) => !rejected?.has(candidate.momentId))
    .map((candidate) => ({
      ...candidate,
      negativeScore: negativeByMoment.get(candidate.momentId) ?? 0,
    }))
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, limit);
}
