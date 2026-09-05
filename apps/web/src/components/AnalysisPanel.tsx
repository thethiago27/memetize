'use client';

import { type MouseEvent, type PointerEvent, useEffect, useMemo, useState } from 'react';
import {
  clampWindow,
  formatField,
  lineAt,
  linesWithin,
  MANUAL_WINDOW_MAX_MS,
  parseTimecode,
  snapToDownbeat,
  snapTolerance,
  thin,
  toOutput,
  toPercent,
  toSource,
  type WindowDraft,
  windowProblem,
} from '../lib/analysis-time';
import {
  type AudioAnalysisRow,
  type EditWindowRow,
  formatTimecode,
  type LyricsRow,
  type ManualWindow,
  type SubtitlesSummary,
} from '../lib/api';
import { LYRIC_SOURCE_LABEL, sectionColor, sectionLabel } from '../lib/labels';

const TICK_MS = 10_000;
const MIN_TEXT_FRACTION = 0.015;
const MAX_BEATS = 2000;

type DragKind = 'start' | 'end' | 'move' | 'new';

interface Drag {
  kind: DragKind;
  /** Source ms under the pointer when the drag began. */
  originMs: number;
  origin: WindowDraft;
}

function mmss(ms: number): string {
  return formatTimecode(ms).slice(0, 5);
}

/**
 * The "Análise" tab: sections, energy with beats, lyric lines, and a ruler on
 * one shared source-time axis, with the selected window and the player's
 * playhead overlaid. "Escolher trecho" turns the window band into a draft the
 * editor drags (edges, whole band, or a fresh band) and refines in mm:ss.
 * Every x position is a percentage of the song duration, so the chart scales
 * with its container without measuring.
 */
export function AnalysisPanel({
  audio,
  lyrics,
  subtitles,
  editWindow,
  manualWindow,
  positionMs,
  locked,
  onSeek,
  onSetWindow,
  onClearWindow,
}: {
  audio: AudioAnalysisRow | null;
  lyrics: LyricsRow | null;
  subtitles: SubtitlesSummary | null;
  editWindow: EditWindowRow | null;
  manualWindow: ManualWindow | null;
  /** The transport's output position (editor-transport spec). */
  positionMs: number;
  /** True while jobs run or another action is in flight: no window changes. */
  locked: boolean;
  onSeek: (outputMs: number) => void;
  /** Resolve `true` on success; the panel keeps its draft or dialog open otherwise. */
  onSetWindow: (window: ManualWindow) => Promise<boolean>;
  onClearWindow: () => Promise<boolean>;
}) {
  const [canSeek, setCanSeek] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<WindowDraft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [startField, setStartField] = useState('');
  const [endField, setEndField] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [saving, setSaving] = useState(false);

  const durationMs = audio?.durationMs ?? 0;
  const lines = lyrics?.lines ?? [];
  const beats = useMemo(() => thin(audio?.beats ?? [], MAX_BEATS), [audio]);
  const sourcePlayheadMs = editWindow ? toSource(positionMs, editWindow) : null;
  const currentLine = sourcePlayheadMs !== null ? lineAt(lines, sourcePlayheadMs) : null;
  const selecting = draft !== null;

  // Keep the fields in step with drags; typing commits on blur or Enter.
  useEffect(() => {
    if (!draft) return;
    setStartField(formatField(draft.startMs));
    setEndField(formatField(draft.endMs));
  }, [draft]);

  if (!audio) {
    return <p className="mute">A análise de áudio ainda não terminou.</p>;
  }

  const pct = (ms: number) => `${(toPercent(ms, durationMs) * 100).toFixed(3)}%`;
  const width = (startMs: number, endMs: number) =>
    `${((toPercent(endMs, durationMs) - toPercent(startMs, durationMs)) * 100).toFixed(3)}%`;

  const sourceAt = (event: { clientX: number; currentTarget: HTMLElement }): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.round(Math.min(1, Math.max(0, fraction)) * durationMs);
  };

  const snap = (ms: number, free: boolean) =>
    free ? ms : snapToDownbeat(ms, audio.downbeats, snapTolerance(durationMs));

  const beginSelection = () => {
    const seed: WindowDraft = editWindow
      ? { startMs: editWindow.sourceStartMs, endMs: editWindow.sourceEndMs }
      : { startMs: 0, endMs: Math.min(durationMs, MANUAL_WINDOW_MAX_MS) };
    setDraft(seed);
  };

  const commitField = (which: 'start' | 'end', value: string) => {
    if (!draft) return;
    const ms = parseTimecode(value);
    if (ms === null) {
      setStartField(formatField(draft.startMs));
      setEndField(formatField(draft.endMs));
      return;
    }
    setDraft(which === 'start' ? { ...draft, startMs: ms } : { ...draft, endMs: ms });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, kind: DragKind) => {
    if (!draft || locked) return;
    event.preventDefault();
    event.stopPropagation();
    const chart = event.currentTarget.closest('.chart') as HTMLElement | null;
    if (!chart) return;
    const originMs = sourceAt({ clientX: event.clientX, currentTarget: chart });
    chart.setPointerCapture(event.pointerId);
    if (kind === 'new') {
      const startMs = snap(originMs, event.shiftKey);
      setDraft({ startMs, endMs: startMs });
      setDrag({ kind, originMs, origin: { startMs, endMs: startMs } });
      return;
    }
    setDrag({ kind, originMs, origin: draft });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const ms = sourceAt(event);
    const free = event.shiftKey;
    const { origin } = drag;
    let next: WindowDraft;
    if (drag.kind === 'move') {
      const delta = ms - drag.originMs;
      const startMs = snap(origin.startMs + delta, free);
      next = clampWindow({ startMs, endMs: startMs + (origin.endMs - origin.startMs) }, durationMs);
    } else if (drag.kind === 'start') {
      next = { startMs: Math.min(snap(ms, free), origin.endMs), endMs: origin.endMs };
    } else if (drag.kind === 'end') {
      next = { startMs: origin.startMs, endMs: Math.max(snap(ms, free), origin.startMs) };
    } else {
      const anchor = origin.startMs;
      const point = snap(ms, free);
      next =
        point >= anchor ? { startMs: anchor, endMs: point } : { startMs: point, endMs: anchor };
    }
    setDraft(clampWindow(next, durationMs));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  const onChartClick = (event: MouseEvent<HTMLDivElement>) => {
    if (selecting || !editWindow) return;
    const outputMs = toOutput(sourceAt(event), editWindow);
    if (outputMs !== null) onSeek(outputMs);
  };

  const energyPoints = audio.energyCurve
    .map(
      (point) =>
        `${(toPercent(point.timeMs, durationMs) * 1000).toFixed(1)},${(100 - point.value * 100).toFixed(1)}`,
    )
    .join(' ');

  const ticks: number[] = [];
  for (let ms = 0; ms <= durationMs; ms += TICK_MS) ticks.push(ms);
  const labelEvery = durationMs > 300_000 ? 30_000 : TICK_MS;

  const problem = draft ? windowProblem(draft, durationMs) : null;
  const covered = draft ? linesWithin(lines, draft.startMs, draft.endMs).length : 0;

  return (
    <div className="stack analysis">
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <div className="cluster">
          <span className="pill">{Math.round(audio.bpm)} bpm</span>
          <span className="pill">{formatTimecode(audio.durationMs)}</span>
          <span className="pill">
            {audio.sections.length} {audio.sections.length === 1 ? 'seção' : 'seções'}
          </span>
          {lyrics ? (
            <span className="cluster" style={{ gap: 6 }}>
              <span className="pill">{LYRIC_SOURCE_LABEL[lyrics.source] ?? lyrics.source}</span>
              <span className="mono mute">
                {lyrics.model} · {lyrics.modelVersion}
              </span>
            </span>
          ) : null}
          {subtitles ? (
            <span className="mute small">
              {subtitles.translated
                ? `Legendas: traduzidas de ${subtitles.sourceLanguage ?? 'und'} · ${subtitles.lineCount} linhas`
                : 'Legendas: letra original (já em português / provedor fixture)'}
            </span>
          ) : null}
          <span className="mono mute">
            analisador {audio.analyzer} · {audio.analyzerVersion}
          </span>
        </div>
        <div className="cluster">
          {manualWindow ? (
            <>
              <span className="pill" data-tone="ok">
                Trecho manual
              </span>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={locked || selecting}
                onClick={() => setConfirmClear(true)}
              >
                Voltar à escolha automática
              </button>
            </>
          ) : editWindow ? (
            <span className="pill" title="Escolhido pelo motor">
              Trecho automático
              <span className="mono mute"> · nota {editWindow.score.toFixed(2)}</span>
            </span>
          ) : null}
          {!selecting ? (
            <button className="btn btn-sm" type="button" disabled={locked} onClick={beginSelection}>
              Escolher trecho
            </button>
          ) : null}
        </div>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the chart is a pointer seek/selection surface; the fields below give keyboard control */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same as above */}
      <div
        className="chart"
        data-mode={selecting ? 'select' : 'view'}
        data-seek={canSeek === null ? 'idle' : canSeek ? 'yes' : 'no'}
        onMouseMove={(event) => {
          if (selecting || !editWindow) return;
          const inside = toOutput(sourceAt(event), editWindow) !== null;
          if (inside !== canSeek) setCanSeek(inside);
        }}
        onMouseLeave={() => setCanSeek(null)}
        onClick={onChartClick}
        onPointerDown={(event) => onPointerDown(event, 'new')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="track track-window">
          {editWindow && !selecting ? (
            <>
              <span
                className="mono mute window-label"
                style={{ left: pct(editWindow.sourceStartMs) }}
              >
                {mmss(editWindow.sourceStartMs)}
              </span>
              <span
                className="mono mute window-label"
                data-edge="end"
                style={{ left: pct(editWindow.sourceEndMs) }}
              >
                {mmss(editWindow.sourceEndMs)}
              </span>
            </>
          ) : null}
          {draft ? (
            <>
              <span className="mono window-label" style={{ left: pct(draft.startMs) }}>
                {formatField(draft.startMs)}
              </span>
              <span
                className="mono window-label"
                data-edge="end"
                style={{ left: pct(draft.endMs) }}
              >
                {formatField(draft.endMs)}
              </span>
            </>
          ) : null}
        </div>

        <div className="track track-sections" title="Seções">
          {audio.sections.map((section) => {
            const fraction =
              toPercent(section.endMs, durationMs) - toPercent(section.startMs, durationMs);
            const label = sectionLabel(section.type);
            return (
              <div
                key={`${section.type}-${section.startMs}`}
                className="section"
                style={{
                  left: pct(section.startMs),
                  width: width(section.startMs, section.endMs),
                  ['--section-color' as string]: sectionColor(section.type),
                }}
                title={`${label} · ${mmss(section.startMs)}–${mmss(section.endMs)}`}
              >
                {fraction >= MIN_TEXT_FRACTION * 3 ? <span>{label}</span> : null}
              </div>
            );
          })}
        </div>

        <div className="track track-energy" title="Energia, batidas e downbeats">
          <svg
            className="energy"
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
            aria-label="Curva de energia"
            role="img"
          >
            {energyPoints ? <polygon points={`0,100 ${energyPoints} 1000,100`} /> : null}
            {audio.downbeats.map((ms) => {
              const x = (toPercent(ms, durationMs) * 1000).toFixed(1);
              return (
                <line
                  key={`d-${ms}`}
                  className="downbeat"
                  x1={x}
                  x2={x}
                  y1="0"
                  y2="100"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {beats.map((beat) => {
              const x = (toPercent(beat.timeMs, durationMs) * 1000).toFixed(1);
              return (
                <line
                  key={`b-${beat.timeMs}`}
                  className="beat"
                  x1={x}
                  x2={x}
                  y1="84"
                  y2="100"
                  style={{ opacity: 0.2 + 0.8 * beat.strength }}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        </div>

        <div className="track track-lyrics" title="Letra">
          {lines.length === 0 ? (
            <span className="mute small lyrics-empty">
              Sem letra: projeto instrumental ou letra ainda em processamento.
            </span>
          ) : (
            lines.map((line) => {
              const fraction =
                toPercent(line.endMs, durationMs) - toPercent(line.startMs, durationMs);
              return (
                <div
                  key={`${line.startMs}-${line.endMs}-${line.text}`}
                  className="lyric"
                  data-current={currentLine === line ? 'true' : 'false'}
                  style={{ left: pct(line.startMs), width: width(line.startMs, line.endMs) }}
                  title={`${mmss(line.startMs)}–${mmss(line.endMs)} · ${line.text}`}
                >
                  {fraction >= MIN_TEXT_FRACTION ? <span>{line.text}</span> : null}
                </div>
              );
            })
          )}
        </div>

        <div className="track track-ruler">
          {ticks.map((ms) => (
            <span
              key={ms}
              className="tick"
              data-major={ms % 30_000 === 0 ? 'true' : 'false'}
              style={{ left: pct(ms) }}
            >
              {ms % labelEvery === 0 ? <span className="mono">{mmss(ms)}</span> : null}
            </span>
          ))}
        </div>

        {editWindow && !selecting ? (
          <div
            className="window"
            style={{
              left: pct(editWindow.sourceStartMs),
              width: width(editWindow.sourceStartMs, editWindow.sourceEndMs),
            }}
          />
        ) : null}

        {draft ? (
          <div
            className="window draft"
            data-invalid={problem ? 'true' : 'false'}
            style={{
              left: pct(Math.min(draft.startMs, draft.endMs)),
              width: width(
                Math.min(draft.startMs, draft.endMs),
                Math.max(draft.startMs, draft.endMs),
              ),
            }}
            onPointerDown={(event) => onPointerDown(event, 'move')}
          >
            <div
              className="handle"
              data-edge="start"
              onPointerDown={(event) => onPointerDown(event, 'start')}
            />
            <div
              className="handle"
              data-edge="end"
              onPointerDown={(event) => onPointerDown(event, 'end')}
            />
          </div>
        ) : null}

        {sourcePlayheadMs !== null && !selecting ? (
          <div className="playhead" style={{ left: pct(sourcePlayheadMs) }} />
        ) : null}
      </div>

      {draft ? (
        <div className="stack window-editor">
          <div className="cluster">
            <label className="field-inline">
              <span className="mute small">Início</span>
              <input
                className="input mono"
                value={startField}
                onChange={(event) => setStartField(event.target.value)}
                onBlur={(event) => commitField('start', event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitField('start', event.currentTarget.value);
                }}
                disabled={saving}
                aria-label="Início do trecho"
              />
            </label>
            <label className="field-inline">
              <span className="mute small">Fim</span>
              <input
                className="input mono"
                value={endField}
                onChange={(event) => setEndField(event.target.value)}
                onBlur={(event) => commitField('end', event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitField('end', event.currentTarget.value);
                }}
                disabled={saving}
                aria-label="Fim do trecho"
              />
            </label>
            <span className="mono mute">
              {formatTimecode(Math.max(0, draft.endMs - draft.startMs))} · cobre {covered}{' '}
              {covered === 1 ? 'linha' : 'linhas'} da letra
            </span>
            <span className="mute small">
              Arraste as bordas; Shift desliga o encaixe no downbeat.
            </span>
            <span style={{ flex: 1 }} />
            <button
              className="btn btn-ghost"
              type="button"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={saving || locked || problem !== null}
              onClick={async () => {
                setSaving(true);
                try {
                  const ok = await onSetWindow({
                    sourceStartMs: draft.startMs,
                    sourceEndMs: draft.endMs,
                  });
                  if (ok) setDraft(null);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Salvando…' : 'Usar este trecho'}
            </button>
          </div>
          {problem ? (
            <p className="notice" data-tone="bad">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}

      {confirmClear ? (
        <div className="overlay">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="clear-title">
            <h2 className="section-title" id="clear-title">
              Voltar à escolha automática?
            </h2>
            <p>A IA vai escolher o trecho de novo e o vídeo será refeito.</p>
            <div className="cluster" style={{ justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={saving}
                onClick={() => setConfirmClear(false)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    if (await onClearWindow()) setConfirmClear(false);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? 'Refazendo…' : 'Voltar à automática'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
