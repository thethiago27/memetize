import type { RenderWarning } from '@memetize/contracts';
import type { Timeline, TimelineClip } from '@memetize/timeline';
import { MIN_CLIP_MS } from './constants';
import type { TimelineIssue, TimelineValidation } from './types';
import { isRenderableZoom } from './zoom';

/**
 * Validates a `Timeline` before any FFmpeg spawn. Overlaps, out-of-range
 * clips, empty coverage, any positive gap, and source-short slots are hard
 * failures — the Renderer must never hand a broken graph to FFmpeg.
 * Short slots and unsupported effects remain warnings.
 */
export function validateTimeline(timeline: Timeline): TimelineValidation {
  const errors: TimelineIssue[] = [];
  const warnings: RenderWarning[] = [];

  if (timeline.clips.length === 0) {
    errors.push({
      code: 'EMPTY_TIMELINE',
      message: 'timeline has no clips',
    });
    return { ok: false, errors, warnings };
  }

  for (const clip of timeline.clips) {
    const { startMs, endMs } = clip.timeline;
    if (startMs >= endMs) {
      errors.push({
        code: 'INVALID_RANGE',
        clipId: clip.id,
        message: `clip "${clip.id}" has startMs (${startMs}) >= endMs (${endMs})`,
      });
      continue;
    }
    if (endMs > timeline.durationMs) {
      errors.push({
        code: 'CLIP_OUT_OF_BOUNDS',
        clipId: clip.id,
        message: `clip "${clip.id}" ends at ${endMs}ms, past the timeline's durationMs (${timeline.durationMs}ms)`,
      });
    }
  }

  const sorted = sortByStart(timeline.clips);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    if (curr.timeline.startMs < prev.timeline.endMs) {
      errors.push({
        code: 'CLIP_OVERLAP',
        clipId: curr.id,
        message: `clip "${curr.id}" (starts ${curr.timeline.startMs}ms) overlaps clip "${prev.id}" (ends ${prev.timeline.endMs}ms)`,
      });
    }
  }

  for (const clip of timeline.clips) {
    const slotMs = clip.timeline.endMs - clip.timeline.startMs;
    if (slotMs > 0 && slotMs < MIN_CLIP_MS) {
      warnings.push({ code: 'CLIP_TOO_SHORT', clipId: clip.id, durationMs: slotMs });
    }

    const sourceMs = clip.source.endMs - clip.source.startMs;
    if (sourceMs < slotMs) {
      errors.push({
        code: 'SOURCE_SHORTER_THAN_SLOT',
        clipId: clip.id,
        message: `clip "${clip.id}" source (${sourceMs}ms) is shorter than its slot (${slotMs}ms)`,
      });
    }

    if (clip.effects.some((effect) => !isRenderableZoom(effect, clip))) {
      warnings.push({
        code: 'UNKNOWN_EFFECT',
        clipId: clip.id,
        message: `clip "${clip.id}" has an unsupported or malformed effect; it is ignored`,
      });
    }
  }

  let cursorMs = 0;
  for (const clip of sorted) {
    const gapMs = clip.timeline.startMs - cursorMs;
    if (gapMs > 0) {
      errors.push({
        code: 'TIMELINE_GAP',
        message: `timeline has a ${gapMs}ms gap from ${cursorMs}ms to ${clip.timeline.startMs}ms`,
      });
    }
    cursorMs = Math.max(cursorMs, clip.timeline.endMs);
  }
  const trailingGapMs = timeline.durationMs - cursorMs;
  if (trailingGapMs > 0) {
    errors.push({
      code: 'TIMELINE_GAP',
      message: `timeline has a ${trailingGapMs}ms gap from ${cursorMs}ms to ${timeline.durationMs}ms`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function sortByStart(clips: readonly TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);
}
