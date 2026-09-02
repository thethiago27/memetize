import { Fragment } from 'react';
import {
  formatTimecode,
  type MomentSummary,
  mediaUrl,
  type NarrativeSegmentRow,
  type TimelineClip,
} from '../lib/api';
import {
  effectBadge,
  FUNCTION_LABEL,
  functionColor,
  functionLabel,
  TRANSITION_STYLE_LABEL,
} from '../lib/labels';

export function TimelineStrip({
  clips,
  durationMs,
  segments,
  moments,
  selectedId,
  playheadMs,
  onSelect,
}: {
  clips: TimelineClip[];
  durationMs: number;
  segments: NarrativeSegmentRow[];
  moments: Record<string, MomentSummary>;
  selectedId: string | null;
  playheadMs: number | null;
  onSelect: (clip: TimelineClip) => void;
}) {
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  return (
    <div className="stack">
      <div className="strip">
        {clips.map((clip, index) => {
          const segment = segmentById.get(clip.reason.segmentId);
          const moment = moments[clip.momentId];
          const slot = clip.timeline.endMs - clip.timeline.startMs;
          const thumb = mediaUrl(moment?.thumbnailPath);
          const playing =
            playheadMs !== null &&
            playheadMs >= clip.timeline.startMs &&
            playheadMs < clip.timeline.endMs;
          const badge = effectBadge(clip);
          // Cut-styles spec: a non-hard transition out of this clip shows as
          // a thin marker on the boundary with the next one.
          const transition = clip.transitionOut;
          const marker =
            index < clips.length - 1 && transition && transition.style !== 'hard'
              ? transition
              : null;
          return (
            <Fragment key={clip.id}>
              <button
                type="button"
                className="clip"
                data-selected={clip.id === selectedId ? 'true' : 'false'}
                data-playing={playing ? 'true' : 'false'}
                style={{
                  flexGrow: Math.max(slot, 1),
                  ['--fn-color' as string]: functionColor(segment?.narrativeFunction),
                  backgroundImage: thumb ? `url(${thumb})` : undefined,
                }}
                title={`${formatTimecode(clip.timeline.startMs)}–${formatTimecode(clip.timeline.endMs)} · ${functionLabel(segment?.narrativeFunction)}${moment ? ` · ${moment.description}` : ''}`}
                onClick={() => onSelect(clip)}
              >
                {badge ? <span className="clip-fx">{badge}</span> : null}
                <span className="clip-label">{formatTimecode(clip.timeline.startMs)}</span>
              </button>
              {marker ? (
                <span
                  role="img"
                  className="cut-marker"
                  data-style={marker.style}
                  title={`${TRANSITION_STYLE_LABEL[marker.style]}, ${marker.durationMs} ms`}
                  aria-label={`Transição: ${TRANSITION_STYLE_LABEL[marker.style]}`}
                />
              ) : null}
            </Fragment>
          );
        })}
      </div>
      <div className="ruler mono">
        <span>00:00:00</span>
        <span>{formatTimecode(durationMs)}</span>
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
