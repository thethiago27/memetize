'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { type AssetDetail, api, formatTimecode } from '../../../lib/api';
import { useInterval } from '../../../lib/use-interval';

const TERMINAL = new Set(['READY', 'FAILED']);

export default function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getAsset(id)
      .then(setDetail)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  useEffect(load, [load]);
  useInterval(load, detail !== null && !TERMINAL.has(detail.asset.status));

  if (error) return <p className="err">{error}</p>;
  if (!detail) return <p className="mute">Loading slate…</p>;

  return (
    <>
      <p className="kicker">{detail.asset.id}</p>
      <h1 className="headline">{detail.asset.filename}</h1>
      <p className="mono mute">
        {detail.asset.status}
        {detail.asset.durationMs != null ? `  ${formatTimecode(detail.asset.durationMs)}` : ''}
        {detail.asset.width && detail.asset.height
          ? `  ${detail.asset.width}×${detail.asset.height}`
          : ''}
      </p>

      <section className="panel">
        <p className="kicker">Scenes</p>
        {detail.scenes.length === 0 ? (
          <p className="mute">No scenes yet — wait for the catalog pipeline.</p>
        ) : (
          detail.scenes.map((scene) => (
            <div key={scene.id} className="row">
              <span className="mono">{scene.id}</span>
              <span className="mono mute">
                {formatTimecode(scene.startMs)}–{formatTimecode(scene.endMs)}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <p className="kicker">Moments</p>
        {detail.moments.length === 0 ? (
          <p className="mute">No moments yet.</p>
        ) : (
          detail.moments.map((moment) => (
            <div key={moment.id} className="row">
              <span>{moment.description}</span>
              <span className="mono mute">
                {formatTimecode(moment.startMs)}–{formatTimecode(moment.endMs)}
              </span>
            </div>
          ))
        )}
      </section>
    </>
  );
}
