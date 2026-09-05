import { RETRIEVE_LIMIT, type RetrievedCandidate } from '@memetize/contracts';
import type { Database } from '@memetize/database';
import type { AppConfig } from '@memetize/shared';
import { searchFeedbackMoments } from './feedback-search';
import {
  embedQuery,
  type QueryVector,
  type SearchExclusions,
  searchMomentsByVector,
} from './search';

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
  /**
   * The segment's length (ms). When no semantically retrieved candidate is at
   * least this long, a second pass searches only moments that are, so the pool
   * always contains material able to cover the segment outright — the coverage
   * resolver cannot place a moment shorter than the span it must fill unless the
   * leftover is itself a full slot.
   */
  coverDurationMs?: number;
}

/** How many coverage-capable candidates the second pass adds per query. */
export const COVERAGE_CANDIDATE_LIMIT = 5;

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
  const durationByMoment = new Map<string, number>();
  const negativeByMoment = new Map<string, number>();
  const rejected = params.rejectedMomentIds;

  const merge = (
    hits: readonly {
      momentId: string;
      assetId: string;
      score: number;
      startMs?: number;
      endMs?: number;
    }[],
    source: 'CATALOG' | 'FEEDBACK',
  ) => {
    for (const hit of hits) {
      if (rejected?.has(hit.momentId)) continue;
      // Cosine similarity (spec section 28's `score = 1 - distance`) can dip
      // below 0 for unrelated vectors; clamp so every layer of the funnel
      // stays in the same [0, 1] range the contracts declare.
      const semanticScore = Math.max(0, Math.min(1, hit.score));
      if (hit.startMs !== undefined && hit.endMs !== undefined) {
        durationByMoment.set(hit.momentId, hit.endMs - hit.startMs);
      }
      const existing = byMoment.get(hit.momentId);
      if (!existing || semanticScore > existing.semanticScore) {
        byMoment.set(hit.momentId, {
          momentId: hit.momentId,
          assetId: hit.assetId,
          semanticScore,
          source,
          negativeScore: 0,
        });
      }
    }
  };

  const embedded: QueryVector[] = [];
  for (const text of queries) {
    const query = await embedQuery(config, text);
    embedded.push(query);
    const [catalogHits, positiveHits, negativeHits] = await Promise.all([
      searchMomentsByVector(db, { query, type: 'MEME', limit, exclude }),
      searchFeedbackMoments(db, { query, polarity: 'POSITIVE', limit, exclude }),
      searchFeedbackMoments(db, { query, polarity: 'NEGATIVE', limit, exclude }),
    ]);
    merge(catalogHits, 'CATALOG');
    merge(positiveHits, 'FEEDBACK');
    for (const hit of negativeHits) {
      const current = negativeByMoment.get(hit.momentId) ?? 0;
      if (hit.score > current) negativeByMoment.set(hit.momentId, hit.score);
    }
  }

  const covers = (momentId: string) =>
    params.coverDurationMs !== undefined &&
    (durationByMoment.get(momentId) ?? 0) >= params.coverDurationMs;

  // Coverage pass: the semantic top-k may hold only moments shorter than the
  // segment (a model that slices scenes finely makes this common for short
  // segments). Search once more restricted to long-enough moments, so the pool
  // always has at least a few candidates that can cover the span outright.
  const coverageIds = new Set<string>();
  if (params.coverDurationMs !== undefined && ![...byMoment.keys()].some(covers)) {
    for (const query of embedded) {
      const hits = await searchMomentsByVector(db, {
        query,
        type: 'MEME',
        limit: COVERAGE_CANDIDATE_LIMIT,
        exclude,
        minDurationMs: params.coverDurationMs,
      });
      merge(hits, 'CATALOG');
      for (const hit of hits) if (!rejected?.has(hit.momentId)) coverageIds.add(hit.momentId);
    }
  }

  const withNegative = Array.from(byMoment.values())
    .map((candidate) => ({
      ...candidate,
      negativeScore: negativeByMoment.get(candidate.momentId) ?? 0,
    }))
    .sort((a, b) => b.semanticScore - a.semanticScore);
  const kept = withNegative.slice(0, limit);
  // Coverage candidates survive the cut even when their similarity is low.
  for (const candidate of withNegative.slice(limit)) {
    if (coverageIds.has(candidate.momentId)) kept.push(candidate);
  }
  return kept;
}
