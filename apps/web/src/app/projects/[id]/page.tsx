'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  formatTimecode,
  hasActiveJobs,
  mediaUrl,
  type ProjectDetail,
  type TimelineClip,
} from '../../../lib/api';
import { useInterval } from '../../../lib/use-interval';

export default function ProjectStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getProject(id)
      .then((next) => {
        setDetail(next);
        setSelectedId((current) => current ?? next.timeline?.data.clips[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  useEffect(load, [load]);
  useInterval(load, detail !== null && hasActiveJobs(detail.jobs));

  const selected = useMemo(
    () => detail?.timeline?.data.clips.find((clip) => clip.id === selectedId) ?? null,
    [detail, selectedId],
  );

  const shortlist = useMemo(() => {
    if (!detail || !selected) return [];
    return (
      detail.matches.find((match) => match.segmentId === selected.reason.segmentId)?.shortlist ?? []
    );
  }, [detail, selected]);

  const durationMs = detail?.timeline?.data.durationMs ?? detail?.audio?.durationMs ?? 1;
  const preview = mediaUrl(detail?.render?.path);
  const slateAhead =
    detail?.timeline != null &&
    detail.render != null &&
    detail.timeline.version !== detail.render.timelineVersion;

  if (error) return <p className="err">{error}</p>;
  if (!detail) return <p className="mute">Loading bay…</p>;

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className="kicker">{detail.project.id}</p>
      <h1 className="headline">{detail.project.filename}</h1>
      <p className="mono mute">
        {detail.project.status}
        {detail.audio
          ? `  ${formatTimecode(detail.audio.durationMs)}  ${detail.audio.bpm} bpm`
          : ''}
        {detail.timeline ? `  timeline v${detail.timeline.version}` : ''}
        {detail.render ? `  render v${detail.render.version}` : ''}
      </p>

      {detail.jobs.length > 0 ? (
        <section className="panel jobs">
          {detail.jobs.map((job) => (
            <span key={job.id} data-status={job.status}>
              {job.type} {job.status}
            </span>
          ))}
        </section>
      ) : null}

      {slateAhead ? (
        <p className="note">Slate is ahead of the print. Render to see the latest swap.</p>
      ) : null}

      <div className="studio">
        <section className="panel">
          <p className="kicker">Timeline</p>
          {!detail.timeline || detail.timeline.data.clips.length === 0 ? (
            <p className="mute">No clips yet. Wait for the motor or regenerate.</p>
          ) : (
            <div className="reel">
              {detail.timeline.data.clips.map((clip) => (
                <ClipBlock
                  key={clip.id}
                  clip={clip}
                  durationMs={durationMs}
                  selected={clip.id === selectedId}
                  functionLabel={
                    detail.narrative.find((segment) => segment.id === clip.reason.segmentId)
                      ?.narrativeFunction
                  }
                  onSelect={() => setSelectedId(clip.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="gate">
            {preview ? (
              <video key={preview} src={preview} controls playsInline>
                <track kind="captions" srcLang="en" label="Captions" />
              </video>
            ) : (
              <div className="empty-gate">No print yet. Hit Render when the slate feels right.</div>
            )}
            <div className="burnin">
              {formatTimecode(durationMs)}
              {detail.render ? `  v${detail.render.version}` : ''}
            </div>
          </div>
        </section>

        <section className="panel">
          <p className="kicker">Candidates</p>
          <div className="actions">
            <button
              className="btn"
              type="button"
              disabled={busy !== null}
              onClick={() => run('generate', () => api.generate(id))}
            >
              {busy === 'generate' ? 'Generating…' : 'Regenerate timeline'}
            </button>
            <button
              className="btn btn-cut"
              type="button"
              disabled={busy !== null || !detail.timeline}
              onClick={() => run('render', () => api.render(id))}
            >
              {busy === 'render' ? 'Rendering…' : 'Render'}
            </button>
          </div>
          {!selected ? (
            <p className="mute">Select a clip on the reel.</p>
          ) : shortlist.length === 0 ? (
            <p className="mute">Empty shortlist for this segment.</p>
          ) : (
            shortlist.map((entry) => (
              <div key={entry.momentId} className="row">
                <div>
                  <div className="mono">{entry.momentId}</div>
                  <div className="mute">final {entry.finalScore.toFixed(2)}</div>
                </div>
                <button
                  className="btn"
                  type="button"
                  disabled={busy !== null || entry.momentId === selected.momentId}
                  onClick={() => run('swap', () => api.swapClip(id, selected.id, entry.momentId))}
                >
                  {entry.momentId === selected.momentId ? 'On slate' : 'Swap in'}
                </button>
              </div>
            ))
          )}
        </section>
      </div>

      <section className="panel">
        <p className="kicker">Project</p>
        {detail.narrative.length === 0 ? (
          <p className="mute">Narrative is still cooking.</p>
        ) : (
          detail.narrative.map((segment) => (
            <div key={segment.id} className="row">
              <span>
                {segment.narrativeFunction} · {segment.emotion}
              </span>
              <span className="mono mute">
                {formatTimecode(segment.startMs)}–{formatTimecode(segment.endMs)}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <p className="kicker">Renders</p>
        {(detail.renders ?? []).length === 0 ? (
          <p className="mute">No prints yet.</p>
        ) : (
          detail.renders.map((render) => (
            <div key={render.version} className="row">
              <span className="mono">
                v{render.version} · timeline v{render.timelineVersion} · {render.width}×
                {render.height}
              </span>
              <span className="mono mute">
                {render.validation.warnings.length > 0
                  ? render.validation.warnings.map((warning) => warning.code).join(' · ')
                  : 'clean'}
              </span>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function ClipBlock({
  clip,
  durationMs,
  selected,
  functionLabel,
  onSelect,
}: {
  clip: TimelineClip;
  durationMs: number;
  selected: boolean;
  functionLabel?: string;
  onSelect: () => void;
}) {
  const slot = clip.timeline.endMs - clip.timeline.startMs;
  const height = Math.max(36, Math.round((slot / durationMs) * 320));
  const zoom = clip.effects?.find((effect) => effect.type === 'zoom');
  return (
    <button
      type="button"
      className="clip"
      data-selected={selected ? 'true' : 'false'}
      style={{ height }}
      onClick={onSelect}
    >
      <div className="mono">
        {formatTimecode(clip.timeline.startMs)}–{formatTimecode(clip.timeline.endMs)}
      </div>
      <div>
        {functionLabel ?? clip.reason.segmentId}
        {zoom ? '  · zoom' : ''}
      </div>
    </button>
  );
}
