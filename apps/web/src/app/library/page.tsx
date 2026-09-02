'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusPill } from '../../components/StatusPill';
import { Thumb } from '../../components/Thumb';
import { useToast } from '../../components/Toast';
import { type AssetRow, api, formatTimecode } from '../../lib/api';
import { ASSET_STATUS_LABEL, assetTone } from '../../lib/labels';
import { useInterval } from '../../lib/use-interval';

const TERMINAL = new Set(['READY', 'FAILED']);

export default function LibraryPage() {
  const { notify } = useToast();
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .listAssets()
      .then((data) => {
        setAssets(data.assets);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);
  useInterval(
    load,
    (assets ?? []).some((asset) => !TERMINAL.has(asset.status)),
  );

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith('video/'));
    if (list.length === 0) {
      notify('Escolha um arquivo de vídeo.', 'bad');
      return;
    }
    setUploading(list.length);
    for (const file of list) {
      try {
        const result = await api.uploadAsset(file);
        notify(
          result.created
            ? `${file.name} adicionado à biblioteca.`
            : `${file.name} já estava na biblioteca.`,
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), 'bad');
      } finally {
        setUploading((count) => count - 1);
      }
    }
    load();
  };

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="headline">Biblioteca</h1>
          <p className="lede">
            Os vídeos daqui viram o catálogo de momentos que o motor usa. Quanto mais variados e
            longos, melhor a cobertura.
          </p>
        </div>
      </div>

      <button
        type="button"
        className="dropzone"
        data-over={over ? 'true' : 'false'}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void upload(event.dataTransfer.files);
        }}
      >
        {uploading > 0
          ? `Enviando ${uploading} arquivo${uploading > 1 ? 's' : ''}…`
          : 'Arraste vídeos aqui ou clique para escolher'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void upload(event.target.files);
          event.target.value = '';
        }}
      />

      {error ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}

      {assets === null ? (
        <p className="mute">Carregando…</p>
      ) : assets.length === 0 ? (
        <div className="empty">
          A biblioteca está vazia. Adicione vídeos para começar um catálogo.
        </div>
      ) : (
        <div className="grid">
          {assets.map((asset) => (
            <Link key={asset.id} href={`/assets/${asset.id}`} className="card">
              <Thumb path={asset.thumbnailPath} alt={asset.filename} />
              <div className="card-title">{asset.filename}</div>
              <div className="cluster" style={{ justifyContent: 'space-between' }}>
                <StatusPill
                  label={ASSET_STATUS_LABEL[asset.status] ?? asset.status}
                  tone={assetTone(asset.status)}
                />
                <span className="mono mute">
                  {asset.durationMs != null ? formatTimecode(asset.durationMs) : ''}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
