import type { FeedbackContext } from '@memetize/contracts';

/**
 * The text a swap teaches the retriever: what the segment asked for. Visual
 * ideas first (they are the retrieval queries), then meaning, then lyrics.
 * Empty parts are skipped so a fixture segment still yields a non-empty
 * string whenever any of the three exists.
 */
export function buildFeedbackText(context: FeedbackContext): string {
  const ideas = (context.visualIdeas ?? []).map((idea) => idea.trim()).filter(Boolean);
  const parts = [ideas.join('; '), context.meaning?.trim() ?? '', context.lyrics?.trim() ?? ''];
  return parts.filter(Boolean).join('\n');
}
