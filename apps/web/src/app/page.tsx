'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { type AssetRow, api, formatTimecode } from '../lib/api';
import { useInterval } from '../lib/use-interval';

const TERMINAL = new Set(['READY', 'FAILED']);

export default function LibraryPage() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listAssets()
      .then((data) => setAssets(data.assets))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);
  useInterval(
    load,
    assets.some((asset) => !TERMINAL.has(asset.status)),
  );

  return (
    <>
      <p className="kicker">Media library</p>
      <h1 className="headline">The bin</h1>
      <p className="lede">
        Catalog clips first. The bay only cuts from what is already indexed — no raw folder browse
        at render time.
      </p>

      <form
        className="panel file"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const file = (form.elements.namedItem('video') as HTMLInputElement).files?.[0];
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            await api.uploadAsset(file);
            form.reset();
            load();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="video">Ingest a clip</label>
        <input id="video" name="video" type="file" accept="video/*" required />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Ingesting…' : 'Add to bin'}
        </button>
      </form>

      {error ? <p className="err">{error}</p> : null}

      <section className="panel">
        {assets.length === 0 ? (
          <p className="mute">Bin is empty. Add a vertical clip to start a catalog.</p>
        ) : (
          assets.map((asset) => (
            <Link key={asset.id} href={`/assets/${asset.id}`} className="row">
              <span>{asset.filename}</span>
              <span className="mono mute">
                {asset.status}
                {asset.durationMs != null ? `  ${formatTimecode(asset.durationMs)}` : ''}
              </span>
            </Link>
          ))
        )}
      </section>
    </>
  );
}
