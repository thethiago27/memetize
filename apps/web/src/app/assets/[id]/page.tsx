'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../../../components/StatusPill';
import { Thumb } from '../../../components/Thumb';
import { useToast } from '../../../components/Toast';
import { type AssetDetail, api, formatTimecode, mediaUrl } from '../../../lib/api';
import { ASSET_STATUS_LABEL, assetTone } from '../../../lib/labels';
import { useInterval } from '../../../lib/use-interval';

const TERMINAL = new Set(['READY', 'FAILED']);

export default function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { notify } = useToast();
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const toggleBan = async () => {
    setBusy(true);
    try {
      await (detail.banned ? api.unbanAsset(id) : api.banAsset(id));
      notify(
        detail.banned
          ? 'Asset reativado.'
          : 'Asset banido. Nenhum momento dele entra em novas timelines.',
      );
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

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
          disabled={busy}
          onClick={() => void toggleBan()}
        >
          {busy ? 'Salvando…' : detail.banned ? 'Reativar asset' : 'Banir asset'}
        </button>
      </div>

      <section className="panel">
        <h2 className="section-title">Cenas</h2>
        {detail.scenes.length === 0 ? (
          <p className="mute">Ainda sem cenas. Aguarde o catálogo terminar.</p>
        ) : (
          detail.scenes.map((scene) => (
            <div key={scene.id} className="stack">
              <span className="mono mute">
                {formatTimecode(scene.startMs)}–{formatTimecode(scene.endMs)}
              </span>
              {scene.frames.length > 0 ? (
                <div className="frames">
                  {scene.frames.map((frame) => (
                    <figure key={frame.path} className="frame" style={{ margin: 0 }}>
                      <img src={mediaUrl(frame.path) ?? ''} alt="" loading="lazy" />
                      <figcaption>{formatTimecode(frame.timestampMs)}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <span className="mute small">Sem frames extraídos.</span>
              )}
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Momentos</h2>
        {detail.moments.length === 0 ? (
          <p className="mute">Ainda sem momentos.</p>
        ) : (
          detail.moments.map((moment) => (
            <div key={moment.id} className="moment">
              <Thumb path={frameFor(moment.sceneId, moment.startMs)} alt="" className="thumb-sm" />
              <div className="moment-body">
                <div>{moment.description}</div>
                <div className="mono mute">
                  {formatTimecode(moment.startMs)}–{formatTimecode(moment.endMs)}
                  {moment.primaryEmotion ? ` · ${moment.primaryEmotion}` : ''}
                  {` · ${moment.id}`}
                </div>
                {moment.banned ? <StatusPill label="Banido" tone="bad" /> : null}
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}
