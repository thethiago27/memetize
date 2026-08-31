import type { RenderWarning } from '@memetize/contracts';
import type { Timeline, TimelineClip } from '@memetize/timeline';
import { MIN_CLIP_MS } from './constants';
import type { TimelineIssue, TimelineValidation } from './types';
import { isRenderableZoom } from './zoom';

/**
 * Validates a `Timeline` before any FFmpeg spawn (spec sections 37-38):
 * overlaps, out-of-range clips and `startMs >= endMs` are hard failures —
 * the Renderer must never hand a broken graph to FFmpeg. Gaps, short
 * slots, source/slot mismatches and unsupported effects are warnings only
 * (spec section 38's editorial checks); they still render, just imperfectly.
 */
export function validateTimeline(timeline: Timeline): TimelineValidation {
  const errors: TimelineIssue[] = [];
  const warnings: RenderWarning[] = [];

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

  if (timeline.clips.length === 0) {
    warnings.push({ code: 'EMPTY_TIMELINE' });
  }

  for (const clip of timeline.clips) {
    const slotMs = clip.timeline.endMs - clip.timeline.startMs;
    if (slotMs > 0 && slotMs < MIN_CLIP_MS) {
      warnings.push({ code: 'CLIP_TOO_SHORT', clipId: clip.id, durationMs: slotMs });
    }

    const sourceMs = clip.source.endMs - clip.source.startMs;
    if (sourceMs < slotMs) {
      warnings.push({ code: 'SOURCE_SHORTER_THAN_SLOT', clipId: clip.id, durationMs: sourceMs });
    }

    if (clip.effects.some((effect) => !isRenderableZoom(effect, clip))) {
      warnings.push({
        code: 'UNKNOWN_EFFECT',
        clipId: clip.id,
        message: `clip "${clip.id}" has an unsupported or malformed effect; it is ignored`,
      });
    }
  }

  if (sorted.length > 0) {
    const frameMs = timeline.canvas.fps > 0 ? 1000 / timeline.canvas.fps : 0;
    let cursorMs = 0;
    for (const clip of sorted) {
      const gapMs = clip.timeline.startMs - cursorMs;
      if (gapMs > 0 && gapMs >= frameMs) {
        warnings.push({ code: 'TIMELINE_GAP', startMs: cursorMs, endMs: clip.timeline.startMs });
      }
      cursorMs = Math.max(cursorMs, clip.timeline.endMs);
    }
    const trailingGapMs = timeline.durationMs - cursorMs;
    if (trailingGapMs > 0 && trailingGapMs >= frameMs) {
      warnings.push({ code: 'TIMELINE_GAP', startMs: cursorMs, endMs: timeline.durationMs });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function sortByStart(clips: readonly TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);
}
