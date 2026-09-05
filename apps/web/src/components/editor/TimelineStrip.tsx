'use client';

import { type MouseEvent, type PointerEvent, useRef } from 'react';
import {
  formatTimecode,
  type MomentSummary,
  mediaUrl,
  type NarrativeSegmentRow,
  type TimelineClip,
} from '../../lib/api';
import {
  effectBadge,
  FUNCTION_LABEL,
  functionColor,
  functionLabel,
  TRANSITION_STYLE_LABEL,
} from '../../lib/labels';
import { clipAt, msToPx, pxToMs, rulerTicks } from '../../lib/strip-geometry';
import { useElementWidth } from '../../lib/use-element-width';
import type { Transport } from '../../lib/use-transport';

/** Clips narrower than this show only their color bar and thumbnail. */
const NARROW_PX = 40;
/** A pointer that travels less than this between down and up is a click. */
const CLICK_SLOP_PX = 3;

function tickLabel(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The timeline strip (editor-transport spec): a ruler with downbeats, clips
 * laid out in pixels from their output range, cut markers on the boundaries
 * and the transport's playhead. Pressing anywhere scrubs; a plain click
 * selects the clip under the pointer. Clip buttons stay reachable by
 * keyboard, so Enter and Space select without the pointer path.
 */
export function TimelineStrip({
  clips,
  durationMs,
  segments,
  moments,
  downbeatsMs,
  selectedId,
  transport,
  onSelect,
}: {
  clips: TimelineClip[];
  durationMs: number;
  segments: NarrativeSegmentRow[];
  moments: Record<string, MomentSummary>;
  downbeatsMs: number[];
  selectedId: string | null;
  transport: Transport;
  onSelect: (clip: TimelineClip) => void;
}) {
  const [stripRef, width] = useElementWidth<HTMLDivElement>();
  const gesture = useRef<{ startX: number; moved: boolean } | null>(null);
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const ticks = rulerTicks(durationMs, width);
  const px = (ms: number) => msToPx(ms, durationMs, width);
  const playing = transport.playing ? clipAt(clips, transport.positionMs) : null;

  const msAt = (event: PointerEvent<HTMLElement>): number => {
    const strip = stripRef.current;
    if (!strip) return 0;
    const rect = strip.getBoundingClientRect();
    return pxToMs(event.clientX - rect.left, durationMs, rect.width);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { startX: event.clientX, moved: false };
    transport.pause();
    // Only the clock moves during the drag; the media seeks once, on release.
    transport.scrub(msAt(event));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    if (Math.abs(event.clientX - current.startX) >= CLICK_SLOP_PX) current.moved = true;
    transport.scrub(msAt(event));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    gesture.current = null;
    const ms = msAt(event);
    if (current.moved) {
      transport.seek(ms);
      return;
    }
    const clip = clipAt(clips, ms);
    if (clip) onSelect(clip);
    else transport.seek(ms);
  };

  /** Keyboard activation only: pointer clicks are already handled by the surface. */
  const onClipClick = (event: MouseEvent<HTMLButtonElement>, clip: TimelineClip) => {
    if (event.detail === 0) onSelect(clip);
  };

  return (
    <div className="stack">
      {/* Pointer scrub surface; the clip buttons and the transport slider give keyboard control. */}
      <div
        className="strip-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="ruler mono">
          {ticks.map((tick) => (
            <span
              key={tick.ms}
              className="tick"
              data-label={tick.label ? 'true' : 'false'}
              style={{ left: px(tick.ms) }}
            >
              {tick.label ? <span className="tick-label">{tickLabel(tick.ms)}</span> : null}
            </span>
          ))}
          {downbeatsMs.map((ms) => (
            <span key={`db-${ms}`} className="downbeat" style={{ left: px(ms) }} />
          ))}
        </div>

        <div className="strip" ref={stripRef}>
          {clips.map((clip) => {
            const segment = segmentById.get(clip.reason.segmentId);
            const moment = moments[clip.momentId];
            const left = px(clip.timeline.startMs);
            const clipWidth = px(clip.timeline.endMs) - left;
            const thumb = mediaUrl(moment?.thumbnailPath);
            const badge = effectBadge(clip);
            return (
              <button
                key={clip.id}
                type="button"
                className="clip"
                data-selected={clip.id === selectedId ? 'true' : 'false'}
                data-playing={playing?.id === clip.id ? 'true' : 'false'}
                data-narrow={clipWidth < NARROW_PX ? 'true' : 'false'}
                style={{
                  left,
                  width: Math.max(clipWidth, 1),
                  ['--fn-color' as string]: functionColor(segment?.narrativeFunction),
                  backgroundImage: thumb ? `url(${thumb})` : undefined,
                }}
                title={`${formatTimecode(clip.timeline.startMs)}–${formatTimecode(clip.timeline.endMs)} · ${functionLabel(segment?.narrativeFunction)}${moment ? ` · ${moment.description}` : ''}`}
                onClick={(event) => onClipClick(event, clip)}
              >
                {badge ? <span className="clip-fx">{badge}</span> : null}
                <span className="clip-label">{formatTimecode(clip.timeline.startMs)}</span>
              </button>
            );
          })}
          {clips.map((clip, index) => {
            // Cut-styles spec: a non-hard transition out of this clip shows as
            // a thin marker centered on the boundary with the next one. It is
            // a sibling of the clips so the clip's overflow does not clip it.
            const transition = clip.transitionOut;
            if (index === clips.length - 1 || !transition || transition.style === 'hard') {
              return null;
            }
            return (
              <span
                key={`cut-${clip.id}`}
                role="img"
                className="cut-marker"
                data-style={transition.style}
                style={{ left: px(clip.timeline.endMs) }}
                title={`${TRANSITION_STYLE_LABEL[transition.style]}, ${transition.durationMs} ms`}
                aria-label={`Transição: ${TRANSITION_STYLE_LABEL[transition.style]}`}
              />
            );
          })}
        </div>

        {durationMs > 0 ? (
          <div className="playhead" style={{ left: px(transport.positionMs) }}>
            <span className="playhead-handle" />
          </div>
        ) : null}
      </div>

      <div className="legend">
        {(Object.keys(FUNCTION_LABEL) as (keyof typeof FUNCTION_LABEL)[]).map((key) => (
          <span key={key} style={{ ['--fn-color' as string]: `var(--fn-${key})` }}>
            {FUNCTION_LABEL[key]}
          </span>
        ))}
      </div>
    </div>
  );
}
