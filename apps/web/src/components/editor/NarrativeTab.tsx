import { formatTimecode, type NarrativeSegmentRow } from '../../lib/api';
import { functionColor, functionLabel } from '../../lib/labels';

/** Segment rows; clicking one selects its clip on the strip (editor-transport spec). */
export function NarrativeTab({
  segments,
  selectedSegmentId,
  onSelectSegment,
}: {
  segments: NarrativeSegmentRow[];
  selectedSegmentId: string | null;
  onSelectSegment: (segmentId: string) => void;
}) {
  if (segments.length === 0) {
    return <p className="mute">A narrativa ainda está sendo analisada.</p>;
  }
  return (
    <>
      {segments.map((row) => (
        <button
          key={row.id}
          type="button"
          className="narrative-row"
          data-selected={row.id === selectedSegmentId ? 'true' : 'false'}
          onClick={() => onSelectSegment(row.id)}
        >
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 2 }}>
              <div className="cluster">
                <span
                  className="pill"
                  data-fn="true"
                  style={{ ['--fn-color' as string]: functionColor(row.narrativeFunction) }}
                >
                  {functionLabel(row.narrativeFunction)}
                </span>
                <span className="pill">{row.emotion}</span>
                <span className="mono mute">energia {row.energy.toFixed(2)}</span>
              </div>
              {row.lyrics ? <span className="quote small">“{row.lyrics}”</span> : null}
              <span className="small">{row.meaning}</span>
            </div>
            <span className="mono mute">
              {formatTimecode(row.startMs)}–{formatTimecode(row.endMs)}
            </span>
          </div>
        </button>
      ))}
    </>
  );
}
