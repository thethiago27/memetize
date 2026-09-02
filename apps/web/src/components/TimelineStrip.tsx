import {
  formatTimecode,
  type MomentSummary,
  mediaUrl,
  type NarrativeSegmentRow,
  type TimelineClip,
} from '../lib/api';
import { FUNCTION_LABEL, functionColor, functionLabel } from '../lib/labels';

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
        {clips.map((clip) => {
          const segment = segmentById.get(clip.reason.segmentId);
          const moment = moments[clip.momentId];
          const slot = clip.timeline.endMs - clip.timeline.startMs;
          const thumb = mediaUrl(moment?.thumbnailPath);
          const playing =
            playheadMs !== null &&
            playheadMs >= clip.timeline.startMs &&
            playheadMs < clip.timeline.endMs;
          return (
            <button
              key={clip.id}
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
              <span className="clip-label">{formatTimecode(clip.timeline.startMs)}</span>
            </button>
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
