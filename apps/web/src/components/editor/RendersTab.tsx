import { formatTimecode, mediaUrl, type RenderRow } from '../../lib/api';

export function RendersTab({ renders }: { renders: RenderRow[] }) {
  if (renders.length === 0) return <p className="mute">Nenhum render ainda.</p>;
  return (
    <>
      {renders.map((render) => (
        <div key={render.version} className="row">
          <span className="mono">
            v{render.version} · timeline v{render.timelineVersion} · {render.width}×{render.height}{' '}
            · {formatTimecode(render.durationMs)}
          </span>
          <span className="cluster">
            <span className="mono mute">
              {render.validation.warnings.length > 0
                ? render.validation.warnings.map((warning) => warning.code).join(' · ')
                : 'sem avisos'}
            </span>
            <a
              className="btn btn-sm btn-ghost"
              href={mediaUrl(render.path) ?? '#'}
              target="_blank"
              rel="noreferrer"
            >
              Abrir
            </a>
          </span>
        </div>
      ))}
    </>
  );
}
