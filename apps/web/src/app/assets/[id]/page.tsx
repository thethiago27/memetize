'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../../../components/StatusPill';
import { Thumb } from '../../../components/Thumb';
import { useToast } from '../../../components/Toast';
import {
  type AssetDetail,
  api,
  type ExcludedRange,
  formatTimecode,
  mediaUrl,
} from '../../../lib/api';
import { ASSET_STATUS_LABEL, assetTone } from '../../../lib/labels';
import { useInterval } from '../../../lib/use-interval';

const TERMINAL = new Set(['READY', 'FAILED']);

function sameRange(a: ExcludedRange, b: ExcludedRange): boolean {
  return a.startMs === b.startMs && a.endMs === b.endMs;
}

function covered(range: ExcludedRange, exclusions: ExcludedRange[]): boolean {
  return exclusions.some((entry) => entry.startMs <= range.startMs && entry.endMs >= range.endMs);
}

export default function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { notify } = useToast();
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  /** Selected frames as "sceneId:timestampMs". */
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    api
      .getAsset(id)
      .then(setDetail)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  useEffect(load, [load]);
  useInterval(load, detail !== null && !TERMINAL.has(detail.asset.status));

  if (error)
    return (
      <p className="notice" data-tone="bad">
        {error}
      </p>
    );
  if (!detail) return <p className="mute">Carregando…</p>;

  const exclusions = detail.exclusions ?? [];

  /** A frame stands for the span until the next frame of its scene (or the scene end). */
  const frameRange = (scene: (typeof detail.scenes)[number], index: number): ExcludedRange => {
    const frame = scene.frames[index];
    const next = scene.frames[index + 1];
    const startMs = frame?.timestampMs ?? scene.startMs;
    return { startMs, endMs: next ? next.timestampMs : scene.endMs };
  };
  const frameKey = (sceneId: string, timestampMs: number) => `${sceneId}:${timestampMs}`;
  const togglePicked = (key: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  /** Merge adjacent selected frames of each scene into contiguous ranges. */
  const pickedRanges = (): ExcludedRange[] => {
    const ranges: ExcludedRange[] = [];
    for (const scene of detail.scenes) {
      let open: ExcludedRange | null = null;
      scene.frames.forEach((frame, index) => {
        const range = frameRange(scene, index);
        if (picked.has(frameKey(scene.id, frame.timestampMs))) {
          if (open && open.endMs === range.startMs) open.endMs = range.endMs;
          else {
            if (open) ranges.push(open);
            open = { ...range };
          }
        } else if (open) {
          ranges.push(open);
          open = null;
        }
      });
      if (open) ranges.push(open);
    }
    return ranges;
  };

  const run = async (label: string, action: () => Promise<unknown>, success: string) => {
    setBusy(label);
    try {
      await action();
      notify(success);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const exclude = (range: ExcludedRange, label: string) =>
    run(
      label,
      () => api.excludeRange(id, range),
      `Trecho ${formatTimecode(range.startMs)}–${formatTimecode(range.endMs)} excluído.`,
    );
  const include = (range: ExcludedRange, label: string) =>
    run(
      label,
      () => api.includeRange(id, range),
      `Trecho ${formatTimecode(range.startMs)}–${formatTimecode(range.endMs)} reativado.`,
    );

  const frameFor = (sceneId: string, startMs: number) => {
    const scene = detail.scenes.find((row) => row.id === sceneId);
    let best: { path: string; d: number } | null = null;
    for (const frame of scene?.frames ?? []) {
      const d = Math.abs(frame.timestampMs - startMs);
      if (!best || d < best.d) best = { path: frame.path, d };
    }
    return best?.path ?? detail.asset.thumbnailPath;
  };

  return (
    <>
      <Link className="back" href="/library">
        ← Biblioteca
      </Link>
      <div className="page-head">
        <div className="cluster" style={{ alignItems: 'flex-start' }}>
          <Thumb
            path={detail.asset.thumbnailPath}
            alt={detail.asset.filename}
            className="thumb-sm"
          />
          <div className="stack">
            <h1 className="headline">{detail.asset.filename}</h1>
            <div className="cluster">
              <StatusPill
                label={ASSET_STATUS_LABEL[detail.asset.status] ?? detail.asset.status}
                tone={assetTone(detail.asset.status)}
              />
              {detail.banned ? <StatusPill label="Banido" tone="bad" /> : null}
              <span className="mono mute">
                {detail.asset.durationMs != null ? formatTimecode(detail.asset.durationMs) : ''}
                {detail.asset.width && detail.asset.height
                  ? ` · ${detail.asset.width}×${detail.asset.height}`
                  : ''}
                {` · ${detail.scenes.length} cenas · ${detail.moments.length} momentos`}
              </span>
            </div>
          </div>
        </div>
        <button
          className={detail.banned ? 'btn' : 'btn btn-danger'}
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run(
              'ban',
              () => (detail.banned ? api.unbanAsset(id) : api.banAsset(id)),
              detail.banned
                ? 'Asset reativado.'
                : 'Asset banido. Nenhum momento dele entra em novas timelines.',
            )
          }
        >
          {busy === 'ban' ? 'Salvando…' : detail.banned ? 'Reativar asset' : 'Banir asset'}
        </button>
      </div>

      <section className="panel">
        <h2 className="section-title">Trechos excluídos</h2>
        <p className="mute small">
          Um trecho excluído nunca vira clipe, mesmo depois de reprocessar o vídeo. Exclua cenas
          inteiras abaixo ou informe um intervalo em segundos.
        </p>
        <form
          className="cluster"
          onSubmit={(event) => {
            event.preventDefault();
            const startMs = Math.round(Number.parseFloat(from) * 1000);
            const endMs = Math.round(Number.parseFloat(to) * 1000);
            if (
              !Number.isFinite(startMs) ||
              !Number.isFinite(endMs) ||
              startMs < 0 ||
              endMs <= startMs
            ) {
              notify('Informe início e fim em segundos, com o fim depois do início.', 'bad');
              return;
            }
            void exclude({ startMs, endMs }, 'range').then(() => {
              setFrom('');
              setTo('');
            });
          }}
        >
          <input
            className="input"
            style={{ width: 120 }}
            inputMode="decimal"
            placeholder="início (s)"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <input
            className="input"
            style={{ width: 120 }}
            inputMode="decimal"
            placeholder="fim (s)"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <button className="btn" type="submit" disabled={busy !== null}>
            {busy === 'range' ? 'Salvando…' : 'Excluir intervalo'}
          </button>
        </form>
        {picked.size > 0 ? (
          <div className="notice cluster" style={{ justifyContent: 'space-between' }}>
            <span>
              {picked.size} frame{picked.size > 1 ? 's' : ''} selecionado
              {picked.size > 1 ? 's' : ''} · {pickedRanges().length} trecho
              {pickedRanges().length > 1 ? 's' : ''}
            </span>
            <span className="cluster">
              <button
                className="btn btn-sm btn-ghost"
                type="button"
                disabled={busy !== null}
                onClick={() => setPicked(new Set())}
              >
                Limpar seleção
              </button>
              <button
                className="btn btn-sm btn-danger"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    'frames',
                    async () => {
                      for (const range of pickedRanges()) await api.excludeRange(id, range);
                      setPicked(new Set());
                    },
                    'Frames selecionados excluídos.',
                  )
                }
              >
                {busy === 'frames' ? 'Excluindo…' : 'Excluir frames selecionados'}
              </button>
            </span>
          </div>
        ) : null}
        {exclusions.length === 0 ? (
          <p className="mute">Nenhum trecho excluído.</p>
        ) : (
          exclusions.map((range) => (
            <div key={`${range.startMs}-${range.endMs}`} className="row">
              <span className="mono">
                {formatTimecode(range.startMs)}–{formatTimecode(range.endMs)}
              </span>
              <button
                className="btn btn-sm btn-ghost"
                type="button"
                disabled={busy !== null}
                onClick={() => include(range, `inc-${range.startMs}`)}
              >
                Reativar
              </button>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Cenas</h2>
        {detail.scenes.length === 0 ? (
          <p className="mute">Ainda sem cenas. Aguarde o catálogo terminar.</p>
        ) : (
          detail.scenes.map((scene) => {
            const range = { startMs: scene.startMs, endMs: scene.endMs };
            const excluded = covered(range, exclusions);
            const exact = exclusions.find((entry) => sameRange(entry, range));
            return (
              <div key={scene.id} className="stack" style={{ opacity: excluded ? 0.55 : 1 }}>
                <div className="row" style={{ borderBottom: 0, padding: 0 }}>
                  <span className="cluster">
                    <span className="mono mute">
                      {formatTimecode(scene.startMs)}–{formatTimecode(scene.endMs)}
                    </span>
                    {excluded ? <StatusPill label="Excluída" tone="bad" /> : null}
                    {scene.frames.length > 0 && !excluded ? (
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        onClick={() => {
                          const keys = scene.frames.map((frame) =>
                            frameKey(scene.id, frame.timestampMs),
                          );
                          const all = keys.every((key) => picked.has(key));
                          setPicked((current) => {
                            const next = new Set(current);
                            for (const key of keys) {
                              if (all) next.delete(key);
                              else next.add(key);
                            }
                            return next;
                          });
                        }}
                      >
                        {scene.frames.every((frame) =>
                          picked.has(frameKey(scene.id, frame.timestampMs)),
                        )
                          ? 'Desmarcar frames'
                          : 'Marcar frames'}
                      </button>
                    ) : null}
                  </span>
                  {exact ? (
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => include(range, `scene-${scene.id}`)}
                    >
                      Reativar cena
                    </button>
                  ) : excluded ? null : (
                    <button
                      className="btn btn-sm btn-danger"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => exclude(range, `scene-${scene.id}`)}
                    >
                      {busy === `scene-${scene.id}` ? 'Salvando…' : 'Excluir cena'}
                    </button>
                  )}
                </div>
                {scene.frames.length > 0 ? (
                  <div className="frames">
                    {scene.frames.map((frame, index) => {
                      const key = frameKey(scene.id, frame.timestampMs);
                      const range = frameRange(scene, index);
                      const gone = exclusions.some(
                        (entry) => entry.startMs <= range.startMs && entry.endMs >= range.endMs,
                      );
                      const on = picked.has(key);
                      return (
                        <label
                          key={frame.path}
                          className="frame"
                          data-picked={on ? 'true' : 'false'}
                          data-gone={gone ? 'true' : 'false'}
                          title={`${formatTimecode(range.startMs)}–${formatTimecode(range.endMs)}`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={gone || busy !== null}
                            onChange={(event) => togglePicked(key, event.target.checked)}
                          />
                          <img src={mediaUrl(frame.path) ?? ''} alt="" loading="lazy" />
                          <span>
                            {formatTimecode(frame.timestampMs)}
                            {gone ? ' · excluído' : ''}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <span className="mute small">Sem frames extraídos.</span>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Momentos</h2>
        {detail.moments.length === 0 ? (
          <p className="mute">Ainda sem momentos.</p>
        ) : (
          detail.moments.map((moment) => {
            const inRange =
              covered({ startMs: moment.startMs, endMs: moment.endMs }, exclusions) ||
              exclusions.some(
                (entry) => moment.startMs < entry.endMs && moment.endMs > entry.startMs,
              );
            return (
              <div key={moment.id} className="moment" style={{ opacity: moment.banned ? 0.6 : 1 }}>
                <Thumb
                  path={frameFor(moment.sceneId, moment.startMs)}
                  alt=""
                  className="thumb-sm"
                />
                <div className="moment-body">
                  <div>{moment.description}</div>
                  <div className="mono mute">
                    {formatTimecode(moment.startMs)}–{formatTimecode(moment.endMs)}
                    {moment.primaryEmotion ? ` · ${moment.primaryEmotion}` : ''}
                    {` · ${moment.id}`}
                  </div>
                  <div className="moment-actions">
                    {moment.banned ? (
                      <StatusPill label={inRange ? 'Excluído por trecho' : 'Excluído'} tone="bad" />
                    ) : null}
                    {inRange ? null : moment.banned ? (
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          run(
                            `mom-${moment.id}`,
                            () => api.unbanMoment(moment.id),
                            'Momento reativado.',
                          )
                        }
                      >
                        Reativar
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          run(
                            `mom-${moment.id}`,
                            () => api.banMoment(moment.id),
                            'Momento excluído.',
                          )
                        }
                      >
                        {busy === `mom-${moment.id}` ? 'Salvando…' : 'Excluir momento'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
