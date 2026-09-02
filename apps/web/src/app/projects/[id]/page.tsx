'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type FeedbackEventRow,
  formatTimecode,
  hasActiveJobs,
  mediaUrl,
  type ProjectDetail,
  type TimelineClip,
} from '../../../lib/api';
import { useInterval } from '../../../lib/use-interval';

const RATINGS = [1, 2, 3, 4, 5] as const;

function describeFeedback(event: FeedbackEventRow): string {
  const role = event.context.narrativeFunction ? ` as ${event.context.narrativeFunction}` : '';
  switch (event.kind) {
    case 'VIDEO_RATING':
      return `Rated timeline v${event.timelineVersion ?? '?'} ${event.value ?? '?'}/5`;
    case 'SWAP_OUT':
      return `Swapped out ${event.momentId}${role}`;
    case 'SWAP_IN':
      return `Swapped in ${event.momentId}${role}`;
    case 'CLIP_UP':
      return `Kept ${event.momentId}${role}`;
    case 'CLIP_DOWN':
      return `Missed ${event.momentId}${role}`;
    case 'NOTE':
      return `Note: ${event.note ?? ''}`;
    case 'PLACED':
      return `Placed ${event.momentId}${role}`;
    default:
      return `${event.kind} ${event.momentId ?? ''}`.trim();
  }
}

export default function ProjectStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

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

  const latestRating = useMemo(
    () => detail?.feedback.find((event) => event.kind === 'VIDEO_RATING')?.value ?? null,
    [detail],
  );

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

      {detail.jobs
        .filter((job) => job.status === 'FAILED' && (job.errorCode || job.errorMessage))
        .map((job) => (
          <section key={`${job.id}-error`} className="panel">
            <p className="kicker">Job failed</p>
            <p className="err">
              {job.type}
              {job.errorCode ? ` · ${job.errorCode}` : ''}
              {job.errorMessage ? ` — ${job.errorMessage}` : ''}
            </p>
            {job.errorCode === 'INSUFFICIENT_CATALOG' ? (
              <p className="note">
                Add more or longer source videos so every selected span can be covered without
                black, freeze, or looping.
              </p>
            ) : null}
          </section>
        ))}

      {detail.editWindow ? (
        <section className="panel">
          <p className="kicker">Selected source window</p>
          <p className="mono">
            {formatTimecode(detail.editWindow.sourceStartMs)}–
            {formatTimecode(detail.editWindow.sourceEndMs)} ·{' '}
            {formatTimecode(detail.editWindow.durationMs)}
          </p>
          <p className="mute">
            {detail.editWindow.selector} v{detail.editWindow.selectorVersion} · score{' '}
            {detail.editWindow.score.toFixed(2)}
          </p>
        </section>
      ) : null}

      {slateAhead ? (
        <p className="note">Slate is ahead of the print. Render to see the latest swap.</p>
      ) : null}

      {detail.timeline ? (
        <section className="panel">
          <p className="kicker">Rate this cut</p>
          <div className="actions">
            {RATINGS.map((value) => (
              <button
                key={value}
                className={value === latestRating ? 'btn btn-cut' : 'btn'}
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run(`rate-${value}`, () => api.feedback(id, { kind: 'VIDEO_RATING', value }))
                }
              >
                {value}
              </button>
            ))}
            <span className="mute">
              {latestRating ? `rated ${latestRating}/5` : 'teaches the ranker what worked'}
            </span>
          </div>
        </section>
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
          {selected ? (
            <div className="actions">
              <button
                className="btn"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run('keep', () => api.feedback(id, { kind: 'CLIP_UP', clipId: selected.id }))
                }
              >
                {busy === 'keep' ? 'Saving…' : 'Keep'}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run('miss', () => api.feedback(id, { kind: 'CLIP_DOWN', clipId: selected.id }))
                }
              >
                {busy === 'miss' ? 'Saving…' : 'Miss'}
              </button>
              <span className="mono mute">{selected.momentId}</span>
            </div>
          ) : null}
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
                <div className="actions">
                  <button
                    className="btn"
                    type="button"
                    disabled={busy !== null || entry.momentId === selected.momentId}
                    onClick={() => run('swap', () => api.swapClip(id, selected.id, entry.momentId))}
                  >
                    {entry.momentId === selected.momentId ? 'On slate' : 'Swap in'}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run('ban', () => api.banMoment(entry.momentId))}
                  >
                    Ban
                  </button>
                </div>
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
        <p className="kicker">Editorial memory</p>
        <form
          className="actions"
          onSubmit={(event) => {
            event.preventDefault();
            const text = note.trim();
            if (!text) return;
            void run('note', async () => {
              await api.feedback(id, { kind: 'NOTE', note: text });
              setNote('');
            });
          }}
        >
          <input
            className="mono"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="A note the Director should remember for this project"
            maxLength={2000}
          />
          <button className="btn" type="submit" disabled={busy !== null || !note.trim()}>
            {busy === 'note' ? 'Saving…' : 'Add note'}
          </button>
        </form>
        {detail.feedback.length === 0 ? (
          <p className="mute">Nothing learned yet. Swap, rate, or note to teach the motor.</p>
        ) : (
          detail.feedback.map((event) => (
            <div key={event.id} className="row">
              <span>
                {describeFeedback(event)}
                {event.projectId === null ? <span className="mute"> · global</span> : null}
              </span>
              <span className="mono mute">{new Date(event.createdAt).toLocaleString()}</span>
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
