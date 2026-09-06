import {
  FeedbackEmbedInput,
  type FeedbackEmbedOutput,
  type FeedbackPolarity,
} from '@memetize/contracts';
import { buildFeedbackText, getFeedbackEvent, upsertFeedbackEmbedding } from '@memetize/feedback';
import { JobFailure } from '@memetize/job-system';
import { createProviders } from '@memetize/model-providers';
import type { JobHandler } from '@memetize/orchestrator';

const POLARITY_BY_KIND: Partial<Record<string, FeedbackPolarity>> = {
  SWAP_IN: 'POSITIVE',
  SWAP_OUT: 'NEGATIVE',
};

/**
 * FEEDBACK_EMBED handler (editorial-memory spec): turns one swap event into a
 * vector the retriever can match future segments against. Any other kind,
 * or an event with nothing to embed, completes as a no-op so the queue
 * never wedges on feedback that carries no text.
 */
export function createFeedbackEmbedHandler(): JobHandler {
  return async (ctx) => {
    const parsed = FeedbackEmbedInput.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new JobFailure('INVALID_INPUT', parsed.error.message, false);
    }
    const { feedbackEventId } = parsed.data;

    const event = await getFeedbackEvent(ctx.db, feedbackEventId);
    if (!event) {
      throw new JobFailure(
        'FEEDBACK_EVENT_NOT_FOUND',
        `feedback event not found: ${feedbackEventId}`,
        false,
      );
    }

    const polarity = POLARITY_BY_KIND[event.kind] ?? null;
    const sourceText = buildFeedbackText(event.context);
    const skip = (reason: string): FeedbackEmbedOutput => {
      ctx.logger.info('feedback_embed_skipped', { feedbackEventId, reason });
      return { feedbackEventId, embedded: false, polarity, model: null, modelVersion: null };
    };
    if (!polarity) return skip(`kind ${event.kind} carries no vector`);
    // Bound as consts so the narrowing survives into the publication closure.
    const { momentId, assetId } = event;
    if (!momentId || !assetId) return skip('event has no moment');
    if (!sourceText) return skip('empty context text');

    const { embedding: provider } = createProviders(ctx.config);
    let vector: number[] | undefined;
    let model = provider.name;
    let modelVersion = '';
    try {
      const result = await provider.embed([sourceText]);
      vector = result.vectors[0];
      model = result.model;
      modelVersion = result.modelVersion;
    } catch (error) {
      throw new JobFailure(
        'FEEDBACK_EMBED_ERROR',
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
    if (!vector) {
      throw new JobFailure('FEEDBACK_EMBED_ERROR', 'embedding provider returned no vector', false);
    }

    // The vector commits together with the job completion, only while this
    // attempt still owns the lease and its generation is current (F08/F09).
    const published = await ctx.publish(async ({ tx }) => {
      await upsertFeedbackEmbedding(tx, {
        feedbackEventId,
        momentId,
        assetId,
        polarity,
        sourceText,
        vector,
        model,
        modelVersion,
      });
      return { feedbackEventId, embedded: true, polarity, model, modelVersion };
    });

    ctx.logger.info('feedback_embed_completed', { feedbackEventId, polarity, model, modelVersion });
    return published;
  };
}
