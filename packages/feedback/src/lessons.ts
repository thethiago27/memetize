import type { FeedbackAggregate } from './aggregate';
import type { FeedbackEventLike } from './types';

export const LESSON_MOMENT_LIMIT = 30;
export const LESSON_NOTE_LIMIT = 10;
export const EXAMPLE_LIMIT = 3;

export type DescribeMoment = (momentId: string) => string | undefined;

export interface BuildLessonsParams {
  aggregate: FeedbackAggregate;
  events: readonly FeedbackEventLike[];
  projectId: string;
  /** Moments currently on the Director's shortlists — lessons stay relevant and bounded. */
  momentIds: Iterable<string>;
  describe: DescribeMoment;
  limits?: { moments?: number; notes?: number };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function quote(description: string | undefined): string {
  return description ? ` ("${description.replace(/"/g, "'")}")` : '';
}

/**
 * Templated, deterministic lessons for the Director prompt (editorial-memory
 * spec): one line per shortlisted moment with any feedback, sorted by id,
 * then the editor's notes (global and this project's), newest first.
 */
export function buildLessons(params: BuildLessonsParams): string[] {
  const momentLimit = params.limits?.moments ?? LESSON_MOMENT_LIMIT;
  const noteLimit = params.limits?.notes ?? LESSON_NOTE_LIMIT;
  const lessons: string[] = [];

  const ids = [...new Set(params.momentIds)].sort();
  for (const momentId of ids) {
    if (lessons.length >= momentLimit) break;
    const usage = params.aggregate.usage.get(momentId);
    if (!usage || usage.wins + usage.losses === 0) continue;
    const parts = [
      `Moment ${momentId}${quote(params.describe(momentId))}: ${usage.wins} positive, ${usage.losses} negative ${plural(usage.wins + usage.losses, 'signal').replace(/^\d+ /, '')}`,
    ];
    for (const fn of [...usage.byFunction.keys()].sort()) {
      const stats = usage.byFunction.get(fn);
      if (!stats) continue;
      if (stats.wins > 0) parts.push(`chosen as ${fn} ${stats.wins}x`);
      if (stats.losses > 0) parts.push(`rejected as ${fn} ${stats.losses}x`);
    }
    lessons.push(`${parts.join('; ')}.`);
  }

  const notes = params.events
    .filter(
      (event) =>
        event.kind === 'NOTE' &&
        event.note &&
        (event.projectId === null || event.projectId === params.projectId),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq)
    .slice(0, noteLimit);
  for (const note of notes) lessons.push(`Editor note: ${note.note}`);

  return lessons;
}

export interface DirectorExampleLike {
  narrativeFunction: string;
  emotion: string;
  meaning: string;
  lyrics: string;
  chosenMomentId: string;
  chosenDescription: string;
}

export interface SegmentForExamples {
  narrativeFunction: string;
  emotion: string;
}

export interface BuildExamplesParams {
  events: readonly FeedbackEventLike[];
  segments: readonly SegmentForExamples[];
  describe: DescribeMoment;
  limit?: number;
}

function norm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Few-shot examples: for each current segment in order, the most recent
 * `SWAP_IN` whose context shares its narrative function and emotion. Each
 * event is used once; stops at `limit`.
 */
export function buildExamples(params: BuildExamplesParams): DirectorExampleLike[] {
  const limit = params.limit ?? EXAMPLE_LIMIT;
  const swapIns = params.events
    .filter((event) => event.kind === 'SWAP_IN' && event.momentId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq);
  const used = new Set<string>();
  const examples: DirectorExampleLike[] = [];

  for (const segment of params.segments) {
    if (examples.length >= limit) break;
    const match = swapIns.find(
      (event) =>
        !used.has(event.id) &&
        norm(event.context.narrativeFunction) === norm(segment.narrativeFunction) &&
        norm(event.context.emotion) === norm(segment.emotion),
    );
    if (!match?.momentId) continue;
    used.add(match.id);
    examples.push({
      narrativeFunction: match.context.narrativeFunction ?? '',
      emotion: match.context.emotion ?? '',
      meaning: match.context.meaning ?? '',
      lyrics: match.context.lyrics ?? '',
      chosenMomentId: match.momentId,
      chosenDescription: params.describe(match.momentId) ?? '',
    });
  }
  return examples;
}
