'use client';

import { formatClock } from '../../lib/strip-geometry';
import type { Transport } from '../../lib/use-transport';

/**
 * Play, pause and seek for the editor's one clock (editor-transport spec).
 * The range input is the keyboard path to any position.
 */
export function TransportBar({
  transport,
  clipDescription,
  renderVersion,
  staleRender,
  preferRender,
  onToggleMode,
}: {
  transport: Transport;
  clipDescription: string | null;
  renderVersion: number | null;
  /** A render exists but is older than the timeline: offer to watch it anyway. */
  staleRender: boolean;
  preferRender: boolean;
  onToggleMode: () => void;
}) {
  const disabled = transport.mode === 'none';
  const modeLabel =
    transport.mode === 'render'
      ? `Render v${renderVersion ?? '?'}`
      : transport.mode === 'storyboard'
        ? 'Storyboard'
        : 'Sem prévia';
  return (
    <div className="transport">
      <div className="transport-row">
        <button
          className="btn btn-sm"
          type="button"
          disabled={disabled}
          aria-label={transport.playing ? 'Pausar' : 'Tocar'}
          onClick={transport.toggle}
        >
          {transport.playing ? '❚❚' : '▶'}
        </button>
        <span className="mono transport-clock">
          {formatClock(transport.positionMs)} / {formatClock(transport.durationMs)}
        </span>
        <span className="transport-clip small" title={clipDescription ?? undefined}>
          {clipDescription ?? 'Nenhum clipe'}
        </span>
        <span className="pill" data-tone={transport.mode === 'render' ? 'ok' : 'idle'}>
          {modeLabel}
        </span>
        {staleRender ? (
          <button className="btn btn-sm btn-ghost" type="button" onClick={onToggleMode}>
            {preferRender ? 'Ver storyboard' : `Ver render v${renderVersion ?? '?'}`}
          </button>
        ) : null}
      </div>
      <input
        className="transport-range"
        type="range"
        min={0}
        max={Math.max(transport.durationMs, 1)}
        step={100}
        value={transport.positionMs}
        disabled={disabled}
        aria-label="Posição"
        onChange={(event) => transport.scrub(Number(event.target.value))}
        onPointerUp={(event) => transport.seek(Number(event.currentTarget.value))}
        onKeyUp={(event) => transport.seek(Number(event.currentTarget.value))}
      />
    </div>
  );
}
