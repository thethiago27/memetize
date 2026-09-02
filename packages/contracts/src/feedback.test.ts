import { describe, expect, it } from 'vitest';
import { FeedbackContext, FeedbackKind, NoteInput, ProjectFeedbackInput } from './feedback';
import { RetrievedCandidate } from './match';
import { JOB_RESOURCE_CLASS, WORKER_VERSION } from './registry';

describe('feedback contracts', () => {
  it('lists every feedback kind the spec defines', () => {
    expect(FeedbackKind.options).toEqual([
      'SWAP_OUT',
      'SWAP_IN',
      'CLIP_UP',
      'CLIP_DOWN',
      'VIDEO_RATING',
      'BAN_MOMENT',
      'UNBAN_MOMENT',
      'BAN_ASSET',
      'UNBAN_ASSET',
      'NOTE',
      'PLACED',
      'EXCLUDE_RANGE',
      'INCLUDE_RANGE',
    ]);
  });

  it('accepts an empty context and a full segment snapshot', () => {
    expect(FeedbackContext.safeParse({}).success).toBe(true);
    const full = FeedbackContext.safeParse({
      segmentId: 'seg_1',
      startMs: 0,
      endMs: 2000,
      emotion: 'joy',
      narrativeFunction: 'payoff',
      visualIdeas: ['cat jumps'],
      energy: 0.7,
      lyrics: 'la la',
      meaning: 'release',
      retrieved: [{ momentId: 'mom_1', assetId: 'ast_1', semanticScore: 0.8 }],
    });
    expect(full.success).toBe(true);
  });

  it('validates project feedback bodies by kind', () => {
    expect(ProjectFeedbackInput.safeParse({ kind: 'VIDEO_RATING', value: 4 }).success).toBe(true);
    expect(ProjectFeedbackInput.safeParse({ kind: 'VIDEO_RATING', value: 6 }).success).toBe(false);
    expect(ProjectFeedbackInput.safeParse({ kind: 'CLIP_UP', clipId: 'clp_1' }).success).toBe(true);
    expect(ProjectFeedbackInput.safeParse({ kind: 'CLIP_DOWN' }).success).toBe(false);
    expect(ProjectFeedbackInput.safeParse({ kind: 'NOTE', note: '   ' }).success).toBe(false);
    expect(NoteInput.safeParse({ note: 'shorter cuts on the drop' }).success).toBe(true);
  });

  it('defaults retrieved candidates to catalog source and no negative score', () => {
    const parsed = RetrievedCandidate.parse({
      momentId: 'mom_1',
      assetId: 'ast_1',
      semanticScore: 0.5,
    });
    expect(parsed.source).toBe('CATALOG');
    expect(parsed.negativeScore).toBe(0);
  });

  it('registers FEEDBACK_EMBED as a GPU job and bumps the learning workers', () => {
    expect(JOB_RESOURCE_CLASS.FEEDBACK_EMBED).toBe('GPU');
    expect(WORKER_VERSION.FEEDBACK_EMBED).toBe('1.0.0');
    expect(WORKER_VERSION.MATCH).toBe('2.0.0');
    expect(WORKER_VERSION.DIRECTOR).toBe('1.1.0');
    expect(WORKER_VERSION.EFFECTS).toBe('1.1.0');
  });
});
