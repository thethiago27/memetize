'use client';

import {
  formatTimecode,
  type MomentSummary,
  mediaUrl,
  type NarrativeSegmentRow,
  type ProjectDetail,
  type TimelineClip,
} from '../../lib/api';
import { functionColor, functionLabel } from '../../lib/labels';
import type { Transport } from '../../lib/use-transport';
import { Thumb } from '../Thumb';

/**
 * The 9:16 screen (editor-transport spec). In `render` mode it is the
 * rendered video; in `storyboard` mode it is the thumbnail of the clip under
 * the playhead over the project's music; otherwise an empty state.
 */
export function Preview({
  transport,
  detail,
  clipAtPlayhead,
  segment,
  moments,
  jobsActive,
}: {
  transport: Transport;
  detail: ProjectDetail;
  clipAtPlayhead: TimelineClip | null;
  segment: NarrativeSegmentRow | undefined;
  moments: Record<string, MomentSummary>;
  jobsActive: boolean;
}) {
  const renderUrl = mediaUrl(detail.render?.path);
  const audioUrl = mediaUrl(detail.timeline?.data.audio.path);

  if (transport.mode === 'render' && renderUrl) {
    return (
      <div className="screen">
        <video
          key={renderUrl}
          ref={transport.attachMedia}
          src={renderUrl}
          playsInline
          preload="auto"
          onEnded={transport.onEnded}
        >
          <track kind="captions" srcLang="pt" label="Legendas" />
        </video>
      </div>
    );
  }

  if (transport.mode === 'storyboard') {
    const moment = clipAtPlayhead ? moments[clipAtPlayhead.momentId] : undefined;
    return (
      <div
        className="screen"
        data-storyboard="true"
        title="O storyboard mostra um frame por clipe, o mais próximo do início do momento."
      >
        {audioUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: the music has no speech; the storyboard is a silent-safe preview
          <audio
            key={audioUrl}
            ref={transport.attachMedia}
            src={audioUrl}
            preload="auto"
            onEnded={transport.onEnded}
          />
        ) : null}
        <Thumb path={moment?.thumbnailPath} alt="" className="storyboard-frame" />
        <div className="storyboard-overlay">
          <div className="cluster">
            <span
              className="pill"
              data-fn="true"
              style={{ ['--fn-color' as string]: functionColor(segment?.narrativeFunction) }}
            >
              {functionLabel(segment?.narrativeFunction)}
            </span>
            <span className="mono">{formatTimecode(transport.positionMs)}</span>
          </div>
          <div className="small">{moment?.description ?? 'Sem momento neste ponto.'}</div>
          <div className="mute small">Prévia sem render</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-empty">
        {jobsActive
          ? 'O motor está montando a timeline…'
          : 'O vídeo aparece aqui depois de gerar a timeline.'}
      </div>
    </div>
  );
}
