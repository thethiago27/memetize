'use client';

import { type MouseEvent, useMemo, useState } from 'react';
import { lineAt, thin, toOutput, toPercent, toSource } from '../lib/analysis-time';
import {
  type AudioAnalysisRow,
  type EditWindowRow,
  formatTimecode,
  type LyricsRow,
} from '../lib/api';
import { LYRIC_SOURCE_LABEL, sectionColor, sectionLabel } from '../lib/labels';

const TICK_MS = 10_000;
const MIN_TEXT_FRACTION = 0.015;
const MAX_BEATS = 2000;

function mmss(ms: number): string {
  return formatTimecode(ms).slice(0, 5);
}

/**
 * The "Análise" tab: sections, energy with beats, lyric lines, and a ruler on
 * one shared source-time axis, with the selected window and the player's
 * playhead overlaid. Every x position is a percentage of the song duration,
 * so the chart scales with its container without measuring.
 */
export function AnalysisPanel({
  audio,
  lyrics,
  editWindow,
  playheadMs,
  onSeek,
}: {
  audio: AudioAnalysisRow | null;
  lyrics: LyricsRow | null;
  editWindow: EditWindowRow | null;
  playheadMs: number | null;
  onSeek: (outputMs: number) => void;
}) {
  const [canSeek, setCanSeek] = useState<boolean | null>(null);

  const durationMs = audio?.durationMs ?? 0;
  const lines = lyrics?.lines ?? [];
  const beats = useMemo(() => thin(audio?.beats ?? [], MAX_BEATS), [audio]);
  const sourcePlayheadMs =
    playheadMs !== null && editWindow ? toSource(playheadMs, editWindow) : null;
  const currentLine = sourcePlayheadMs !== null ? lineAt(lines, sourcePlayheadMs) : null;

  if (!audio) {
    return <p className="mute">A análise de áudio ainda não terminou.</p>;
  }

  const pct = (ms: number) => `${(toPercent(ms, durationMs) * 100).toFixed(3)}%`;
  const width = (startMs: number, endMs: number) =>
    `${((toPercent(endMs, durationMs) - toPercent(startMs, durationMs)) * 100).toFixed(3)}%`;

  const sourceAt = (event: MouseEvent<HTMLElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.round(Math.min(1, Math.max(0, fraction)) * durationMs);
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

  return (
    <div className="stack analysis">
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
        <span className="mono mute">
          analisador {audio.analyzer} · {audio.analyzerVersion}
        </span>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the chart is a pointer seek surface; the player keeps keyboard control */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same as above */}
      <div
        className="chart"
        data-seek={canSeek === null ? 'idle' : canSeek ? 'yes' : 'no'}
        onMouseMove={(event) => {
          if (!editWindow) return;
          const inside = toOutput(sourceAt(event), editWindow) !== null;
          if (inside !== canSeek) setCanSeek(inside);
        }}
        onMouseLeave={() => setCanSeek(null)}
        onClick={(event) => {
          if (!editWindow) return;
          const outputMs = toOutput(sourceAt(event), editWindow);
          if (outputMs !== null) onSeek(outputMs);
        }}
      >
        <div className="track track-window">
          {editWindow ? (
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

        {editWindow ? (
          <div
            className="window"
            style={{
              left: pct(editWindow.sourceStartMs),
              width: width(editWindow.sourceStartMs, editWindow.sourceEndMs),
            }}
          />
        ) : null}

        {sourcePlayheadMs !== null ? (
          <div className="playhead" style={{ left: pct(sourcePlayheadMs) }} />
        ) : null}
      </div>
    </div>
  );
}
