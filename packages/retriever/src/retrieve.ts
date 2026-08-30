import { RETRIEVE_LIMIT, type RetrievedCandidate } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import type { AppConfig } from '@memetize/shared';
import { searchMoments } from './search';

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
 * 28): runs `searchMoments` once per query derived from the segment, then
 * unions the results by `momentId`, keeping each moment's best score.
 * Multiple `visualIdeas` pointing at the same moment should not count it
 * twice or let a weaker query's score win.
 */
export async function retrieveForSegment(
  db: Database,
  config: AppConfig,
  segment: SegmentForRetrieval,
  params: RetrieveForSegmentParams = {},
): Promise<RetrievedCandidate[]> {
  const limit = params.limit ?? RETRIEVE_LIMIT;
  const queries = buildQueries(segment);

  const byMoment = new Map<string, RetrievedCandidate>();
  for (const query of queries) {
    const hits = await searchMoments(db, config, { query, type: 'MEME', limit });
    for (const hit of hits) {
      // Cosine similarity (spec section 28's `score = 1 - distance`) can dip
      // below 0 for unrelated vectors; clamp so every layer of the funnel
      // stays in the same [0, 1] range the contracts declare.
      const semanticScore = Math.max(0, Math.min(1, hit.score));
      const existing = byMoment.get(hit.momentId);
      if (!existing || semanticScore > existing.semanticScore) {
        byMoment.set(hit.momentId, { momentId: hit.momentId, assetId: hit.assetId, semanticScore });
      }
    }
  }

  return Array.from(byMoment.values())
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, limit);
}
