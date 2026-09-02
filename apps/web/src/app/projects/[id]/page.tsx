'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisPanel } from '../../../components/AnalysisPanel';
import { Inspector } from '../../../components/Inspector';
import { StatusPill } from '../../../components/StatusPill';
import { latestJobByType, Stepper } from '../../../components/Stepper';
import { TimelineStrip } from '../../../components/TimelineStrip';
import { useToast } from '../../../components/Toast';
import {
  api,
  formatTimecode,
  hasActiveJobs,
  mediaUrl,
  type ProjectDetail,
  type TimelineClip,
} from '../../../lib/api';
import {
  describeFeedback,
  functionColor,
  functionLabel,
  JOB_LABEL,
  JOB_STATUS_LABEL,
  jobTone,
  PROJECT_STATUS_LABEL,
  projectTone,
  shortName,
} from '../../../lib/labels';
import { useInterval } from '../../../lib/use-interval';

const RATINGS = [1, 2, 3, 4, 5] as const;
type Tab = 'narrativa' | 'analise' | 'renders' | 'memoria' | 'jobs';

export default function ProjectEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { notify } = useToast();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<Tab>('narrativa');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = useCallback(() => {
    api
      .getProject(id)
      .then((next) => {
        setDetail(next);
        setError(null);
        setSelectedId((current) => current ?? next.timeline?.data.clips[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  useEffect(load, [load]);
  useInterval(load, detail !== null && hasActiveJobs(detail.jobs));

  const clips = detail?.timeline?.data.clips ?? [];
  // Older API processes answer without these fields; never let a missing map crash the editor.
  const moments = detail?.moments ?? {};
  const feedback = detail?.feedback ?? [];
  const selected = useMemo(
    () => clips.find((clip) => clip.id === selectedId) ?? null,
    [clips, selectedId],
  );
  const segment = useMemo(
    () =>
      selected ? detail?.narrative.find((row) => row.id === selected.reason.segmentId) : undefined,
    [detail, selected],
  );
  const shortlist = useMemo(() => {
    if (!detail || !selected) return [];
    return (
      detail.matches.find((match) => match.segmentId === selected.reason.segmentId)?.shortlist ?? []
    );
  }, [detail, selected]);
  const latestRating = useMemo(
    () => feedback.find((event) => event.kind === 'VIDEO_RATING')?.value ?? null,
    [feedback],
  );
  const failedJobs = useMemo(() => {
    if (!detail) return [];
    return [...latestJobByType(detail.jobs).values()].filter((job) => job.status === 'FAILED');
  }, [detail]);

  if (error)
    return (
      <p className="notice" data-tone="bad">
        {error}
      </p>
    );
  if (!detail) return <p className="mute">Carregando…</p>;

  const durationMs =
    detail.timeline?.data.durationMs ??
    detail.editWindow?.durationMs ??
    detail.audio?.durationMs ??
    1;
  const preview = mediaUrl(detail.render?.path);
  const stale =
    detail.timeline != null &&
    detail.render != null &&
    detail.timeline.version !== detail.render.timelineVersion;
  const momentName = (momentId: string) => moments[momentId]?.description ?? momentId;

  const run = async (label: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(label);
    try {
      await action();
      if (success) notify(success);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const selectClip = (clip: TimelineClip) => {
    setSelectedId(clip.id);
    const video = videoRef.current;
    if (video && preview) {
      video.currentTime = clip.timeline.startMs / 1000;
    }
  };

  return (
    <>
      <Link className="back" href="/">
        ← Projetos
      </Link>

      <div className="page-head">
        <div className="stack">
          <h1 className="headline">{shortName(detail.project.filename)}</h1>
          <div className="cluster">
            <StatusPill
              label={PROJECT_STATUS_LABEL[detail.project.status] ?? detail.project.status}
              tone={projectTone(detail.project.status)}
            />
            <span className="mono mute">
              {detail.audio
                ? `${formatTimecode(detail.audio.durationMs)} · ${Math.round(detail.audio.bpm)} bpm`
                : 'aguardando análise'}
              {detail.timeline ? ` · timeline v${detail.timeline.version}` : ''}
              {detail.render ? ` · render v${detail.render.version}` : ''}
            </span>
          </div>
        </div>
        <div className="cluster">
          {detail.timeline ? (
            <span className="cluster" title="Avaliar este corte ensina o ranker o que funcionou">
              <span className="mute small">Avaliar corte</span>
              <span className="rating">
                {RATINGS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="star"
                    data-on={latestRating !== null && value <= latestRating ? 'true' : 'false'}
                    aria-label={`${value} de 5`}
                    disabled={busy !== null}
                    onClick={() =>
                      run(
                        `rate-${value}`,
                        () => api.feedback(id, { kind: 'VIDEO_RATING', value }),
                        `Avaliação ${value}/5 salva.`,
                      )
                    }
                  >
                    ★
                  </button>
                ))}
              </span>
            </span>
          ) : null}
          <button
            className="btn"
            type="button"
            disabled={busy !== null || hasActiveJobs(detail.jobs)}
            onClick={() => run('generate', () => api.generate(id), 'Gerando uma nova timeline…')}
          >
            {busy === 'generate' ? 'Gerando…' : 'Gerar timeline'}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy !== null || !detail.timeline || hasActiveJobs(detail.jobs)}
            onClick={() => run('render', () => api.render(id), 'Render iniciado.')}
          >
            {busy === 'render' ? 'Renderizando…' : 'Renderizar'}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            title="Excluir este projeto"
            disabled={busy !== null}
            onClick={() => setConfirmDelete(true)}
          >
            Excluir
          </button>
        </div>
      </div>

      {confirmDelete ? (
        <div className="overlay">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <h2 className="section-title" id="delete-title">
              Excluir projeto?
            </h2>
            <p>
              <strong>{shortName(detail.project.filename)}</strong> será removido com a música, a
              análise, as timelines e os renders. Isso não pode ser desfeito.
            </p>
            <p className="mute small">
              A memória editorial (avaliações, trocas, notas) é mantida para os próximos projetos.
            </p>
            <div className="cluster" style={{ justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirmDelete(false)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy('delete');
                  try {
                    await api.deleteProject(id);
                    notify('Projeto excluído.');
                    router.push('/');
                  } catch (err) {
                    notify(err instanceof Error ? err.message : String(err), 'bad');
                    setBusy(null);
                    setConfirmDelete(false);
                  }
                }}
              >
                {busy === 'delete' ? 'Excluindo…' : 'Excluir projeto'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <Stepper jobs={detail.jobs} />
        {failedJobs.map((job) => (
          <div key={job.id} className="notice" data-tone="bad">
            <strong>{JOB_LABEL[job.type] ?? job.type} falhou</strong>
            {job.errorCode ? ` · ${job.errorCode}` : ''}
            {job.errorMessage ? ` — ${job.errorMessage}` : ''}
            {job.errorCode === 'INSUFFICIENT_CATALOG' ? (
              <div className="small">
                Adicione mais vídeos, ou vídeos mais longos, à biblioteca e gere a timeline de novo.
              </div>
            ) : null}
          </div>
        ))}
        {stale ? (
          <p className="notice">
            A timeline mudou depois do último render. Renderize para ver a troca.
          </p>
        ) : null}
        {detail.editWindow ? (
          <p className="mono mute small">
            Trecho da música: {formatTimecode(detail.editWindow.sourceStartMs)}–
            {formatTimecode(detail.editWindow.sourceEndMs)} · saída{' '}
            {formatTimecode(detail.editWindow.durationMs)} · seletor {detail.editWindow.selector} v
            {detail.editWindow.selectorVersion} · score {detail.editWindow.score.toFixed(2)}
          </p>
        ) : null}
      </section>

      <div className="editor">
        <section className="panel preview">
          <div className="screen">
            {preview ? (
              <video
                key={preview}
                ref={videoRef}
                src={preview}
                controls
                playsInline
                onTimeUpdate={(event) =>
                  setPlayheadMs(Math.round(event.currentTarget.currentTime * 1000))
                }
                onPause={() => setPlayheadMs(null)}
              >
                <track kind="captions" srcLang="pt" label="Legendas" />
              </video>
            ) : (
              <div className="screen-empty">
                {detail.timeline
                  ? 'Ainda não há render. Clique em Renderizar para ver o vídeo.'
                  : 'O vídeo aparece aqui depois do render.'}
              </div>
            )}
          </div>
          {clips.length === 0 ? (
            <div className="empty">
              {hasActiveJobs(detail.jobs)
                ? 'O motor está montando a timeline…'
                : 'Ainda não há clipes. Gere a timeline.'}
            </div>
          ) : (
            <TimelineStrip
              clips={clips}
              durationMs={durationMs}
              segments={detail.narrative}
              moments={moments}
              selectedId={selectedId}
              playheadMs={playheadMs}
              onSelect={selectClip}
            />
          )}
        </section>

        <Inspector
          clip={selected}
          segment={segment}
          moments={moments}
          shortlist={shortlist}
          busy={busy}
          onThumb={(kind) =>
            selected &&
            run(
              kind === 'CLIP_UP' ? 'up' : 'down',
              () => api.feedback(id, { kind, clipId: selected.id }),
              kind === 'CLIP_UP'
                ? 'Clipe marcado como funcionou.'
                : 'Clipe marcado como não funcionou.',
            )
          }
          onSwap={(momentId) =>
            selected &&
            run(
              `swap-${momentId}`,
              () => api.swapClip(id, selected.id, momentId),
              'Clipe trocado. Renderize para ver.',
            )
          }
          onBan={(momentId) =>
            run(
              `ban-${momentId}`,
              () => api.banMoment(momentId),
              'Momento banido. Ele não entra em novas timelines.',
            )
          }
        />
      </div>

      <section className="panel">
        <div className="tabs" role="tablist">
          {(
            [
              ['narrativa', 'Narrativa'],
              ['analise', 'Análise'],
              ['renders', 'Renders'],
              ['memoria', 'Memória editorial'],
              ['jobs', 'Jobs'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              className="tab"
              data-active={tab === key ? 'true' : 'false'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'narrativa' ? (
          detail.narrative.length === 0 ? (
            <p className="mute">A narrativa ainda está sendo analisada.</p>
          ) : (
            detail.narrative.map((row) => (
              <div key={row.id} className="row" style={{ alignItems: 'flex-start' }}>
                <div className="stack" style={{ gap: 2 }}>
                  <div className="cluster">
                    <span
                      className="pill"
                      data-fn="true"
                      style={{ ['--fn-color' as string]: functionColor(row.narrativeFunction) }}
                    >
                      {functionLabel(row.narrativeFunction)}
                    </span>
                    <span className="pill">{row.emotion}</span>
                    <span className="mono mute">energia {row.energy.toFixed(2)}</span>
                  </div>
                  {row.lyrics ? <span className="quote small">“{row.lyrics}”</span> : null}
                  <span className="small">{row.meaning}</span>
                </div>
                <span className="mono mute">
                  {formatTimecode(row.startMs)}–{formatTimecode(row.endMs)}
                </span>
              </div>
            ))
          )
        ) : null}

        {tab === 'analise' ? (
          <AnalysisPanel
            audio={detail.audio}
            lyrics={detail.lyrics}
            editWindow={detail.editWindow}
            playheadMs={playheadMs}
            onSeek={(outputMs) => {
              const video = videoRef.current;
              if (video) video.currentTime = outputMs / 1000;
            }}
          />
        ) : null}

        {tab === 'renders' ? (
          (detail.renders ?? []).length === 0 ? (
            <p className="mute">Nenhum render ainda.</p>
          ) : (
            detail.renders.map((render) => (
              <div key={render.version} className="row">
                <span className="mono">
                  v{render.version} · timeline v{render.timelineVersion} · {render.width}×
                  {render.height} · {formatTimecode(render.durationMs)}
                </span>
                <span className="cluster">
                  <span className="mono mute">
                    {render.validation.warnings.length > 0
                      ? render.validation.warnings.map((warning) => warning.code).join(' · ')
                      : 'sem avisos'}
                  </span>
                  <a
                    className="btn btn-sm btn-ghost"
                    href={mediaUrl(render.path) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir
                  </a>
                </span>
              </div>
            ))
          )
        ) : null}

        {tab === 'memoria' ? (
          <>
            <form
              className="cluster"
              onSubmit={(event) => {
                event.preventDefault();
                const text = note.trim();
                if (!text) return;
                void run(
                  'note',
                  async () => {
                    await api.feedback(id, { kind: 'NOTE', note: text });
                    setNote('');
                  },
                  'Nota adicionada. O Director passa a considerá-la.',
                );
              }}
            >
              <input
                className="input"
                style={{ flex: 1, minWidth: 240 }}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Uma instrução para o Director lembrar neste projeto"
                maxLength={2000}
              />
              <button className="btn" type="submit" disabled={busy !== null || !note.trim()}>
                {busy === 'note' ? 'Salvando…' : 'Adicionar nota'}
              </button>
            </form>
            {feedback.length === 0 ? (
              <p className="mute">
                Nada aprendido ainda. Troque, avalie ou anote para ensinar o motor.
              </p>
            ) : (
              feedback.map((event) => (
                <div key={event.id} className="row">
                  <span className="small">
                    {describeFeedback(event, momentName)}
                    {event.projectId === null ? <span className="mute"> · global</span> : null}
                  </span>
                  <span className="mono mute">
                    {new Date(event.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
              ))
            )}
          </>
        ) : null}

        {tab === 'jobs' ? (
          detail.jobs.length === 0 ? (
            <p className="mute">Nenhum job ainda.</p>
          ) : (
            detail.jobs.map((job) => (
              <div key={job.id} className="row">
                <span className="cluster">
                  <StatusPill
                    label={JOB_STATUS_LABEL[job.status] ?? job.status}
                    tone={jobTone(job.status)}
                  />
                  <span>{JOB_LABEL[job.type] ?? job.type}</span>
                </span>
                <span className="mono mute small">
                  {job.errorCode
                    ? `${job.errorCode} ${job.errorMessage ?? ''}`
                    : new Date(job.createdAt).toLocaleString('pt-BR')}
                </span>
              </div>
            ))
          )
        ) : null}
      </section>
    </>
  );
}
