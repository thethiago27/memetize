import {
  formatTimecode,
  type MomentSummary,
  type NarrativeSegmentRow,
  type ShortlistEntry,
  type TimelineClip,
} from '../lib/api';
import { functionColor, functionLabel } from '../lib/labels';
import { Thumb } from './Thumb';

export function Inspector({
  clip,
  segment,
  moments,
  shortlist,
  busy,
  onThumb,
  onSwap,
  onBan,
}: {
  clip: TimelineClip | null;
  segment: NarrativeSegmentRow | undefined;
  moments: Record<string, MomentSummary>;
  shortlist: ShortlistEntry[];
  busy: string | null;
  onThumb: (kind: 'CLIP_UP' | 'CLIP_DOWN') => void;
  onSwap: (momentId: string) => void;
  onBan: (momentId: string) => void;
}) {
  if (!clip) {
    return (
      <section className="panel">
        <h2 className="section-title">Clipe</h2>
        <div className="empty">
          Selecione um clipe na timeline para ver o segmento e os candidatos.
        </div>
      </section>
    );
  }
  const current = moments[clip.momentId];
  return (
    <section className="panel">
      <div className="stack">
        <h2 className="section-title">Segmento</h2>
        <div className="cluster">
          <span
            className="pill"
            data-fn="true"
            style={{ ['--fn-color' as string]: functionColor(segment?.narrativeFunction) }}
          >
            {functionLabel(segment?.narrativeFunction)}
          </span>
          {segment?.emotion ? <span className="pill">{segment.emotion}</span> : null}
          <span className="mono mute">
            {formatTimecode(clip.timeline.startMs)}–{formatTimecode(clip.timeline.endMs)}
          </span>
        </div>
        {segment?.lyrics ? <p className="quote">“{segment.lyrics}”</p> : null}
        {segment?.meaning ? <p className="small">{segment.meaning}</p> : null}
        {segment && segment.visualIdeas.length > 0 ? (
          <p className="mute small">Ideias visuais: {segment.visualIdeas.join(' · ')}</p>
        ) : null}
      </div>

      <div className="stack">
        <h2 className="section-title">Momento atual</h2>
        <div className="moment" data-current="true">
          <Thumb path={current?.thumbnailPath} alt="" className="thumb-sm" />
          <div className="moment-body">
            <div>{current?.description ?? clip.momentId}</div>
            <div className="mono mute">
              {current?.assetFilename ?? clip.source.assetId} ·{' '}
              {formatTimecode(clip.source.startMs)}–{formatTimecode(clip.source.endMs)} · score{' '}
              {clip.reason.finalScore.toFixed(2)}
            </div>
            <div className="moment-actions">
              <button
                className="btn btn-sm"
                type="button"
                disabled={busy !== null}
                onClick={() => onThumb('CLIP_UP')}
              >
                {busy === 'up' ? 'Salvando…' : 'Funcionou'}
              </button>
              <button
                className="btn btn-sm btn-danger"
                type="button"
                disabled={busy !== null}
                onClick={() => onThumb('CLIP_DOWN')}
              >
                {busy === 'down' ? 'Salvando…' : 'Não funcionou'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="stack">
        <h2 className="section-title">Candidatos</h2>
        {shortlist.length === 0 ? (
          <p className="mute">Sem candidatos para este segmento.</p>
        ) : (
          shortlist.map((entry) => {
            const moment = moments[entry.momentId];
            const inUse = entry.momentId === clip.momentId;
            return (
              <div key={entry.momentId} className="moment" data-current={inUse ? 'true' : 'false'}>
                <Thumb path={moment?.thumbnailPath} alt="" className="thumb-sm" />
                <div className="moment-body">
                  <div>{moment?.description ?? entry.momentId}</div>
                  <div className="mono mute">
                    {moment?.assetFilename ?? entry.assetId}
                    {moment ? ` · ${formatTimecode(moment.durationMs)}` : ''} · score{' '}
                    {entry.finalScore.toFixed(2)}
                  </div>
                  <div className="moment-actions">
                    {inUse ? (
                      <span className="pill" data-tone="ok">
                        Em uso
                      </span>
                    ) : (
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => onSwap(entry.momentId)}
                      >
                        {busy === `swap-${entry.momentId}` ? 'Trocando…' : 'Usar'}
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onBan(entry.momentId)}
                    >
                      Banir
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
