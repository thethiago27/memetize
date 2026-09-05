'use client';

import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { EditorHeader } from '../../../components/editor/EditorHeader';
import { type EditorTab, EditorTabs } from '../../../components/editor/EditorTabs';
import { PipelineStatus } from '../../../components/editor/PipelineStatus';
import { Preview } from '../../../components/editor/Preview';
import { TimelineStrip } from '../../../components/editor/TimelineStrip';
import { TransportBar } from '../../../components/editor/TransportBar';
import { Inspector } from '../../../components/Inspector';
import { latestJobByType } from '../../../components/Stepper';
import { useToast } from '../../../components/Toast';
import {
  api,
  hasActiveJobs,
  type ProjectDetail,
  type TimelineClip,
  type TimelineVersion,
} from '../../../lib/api';
import { clipAt, outputDownbeats } from '../../../lib/strip-geometry';
import { useEditorActions } from '../../../lib/use-editor-actions';
import { useInterval } from '../../../lib/use-interval';
import { useTransport } from '../../../lib/use-transport';

const NO_CLIPS: TimelineClip[] = [];

/**
 * The project editor (editor-transport spec): loads the project, owns the
 * selection, runs the transport and the action tracker, and composes the
 * header, pipeline status, preview, strip, inspector and tabs.
 */
export default function ProjectEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { notify } = useToast();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<EditorTab>('narrativa');
  const [preferRender, setPreferRender] = useState(false);

  const load = useCallback(() => {
    api
      .getProject(id)
      .then((next) => {
        setDetail(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  useEffect(load, [load]);
  const jobsActive = detail !== null && hasActiveJobs(detail.jobs);
  useInterval(load, jobsActive);

  const clips = detail?.timeline?.data.clips ?? NO_CLIPS;
  // Older API processes answer without these fields; never let a missing map crash the editor.
  const moments = detail?.moments ?? {};
  const feedback = detail?.feedback ?? [];

  const transport = useTransport({
    timeline: detail?.timeline ?? null,
    render: detail?.render ?? null,
    preferRender,
  });
  const actions = useEditorActions({ reload: load, notify, jobsActive });

  const clipAtPlayhead = useMemo(
    () => clipAt(clips, transport.positionMs),
    [clips, transport.positionMs],
  );

  // Selection survives reloads; when a new timeline drops the selected id,
  // fall back to the clip under the playhead, then to the first clip.
  useEffect(() => {
    if (clips.length === 0) return;
    if (selectedId !== null && clips.some((clip) => clip.id === selectedId)) return;
    setSelectedId((clipAtPlayhead ?? clips[0])?.id ?? null);
  }, [clips, selectedId, clipAtPlayhead]);

  const segmentById = useMemo(
    () => new Map((detail?.narrative ?? []).map((row) => [row.id, row])),
    [detail],
  );
  const selected = useMemo(
    () => clips.find((clip) => clip.id === selectedId) ?? null,
    [clips, selectedId],
  );
  const segment = selected ? segmentById.get(selected.reason.segmentId) : undefined;
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
  const downbeatsMs = useMemo(
    () =>
      outputDownbeats(
        detail?.audio?.downbeats ?? [],
        detail?.editWindow ?? null,
        transport.durationMs,
      ),
    [detail, transport.durationMs],
  );

  if (error)
    return (
      <p className="notice" data-tone="bad">
        {error}
      </p>
    );
  if (!detail) return <p className="mute">Carregando…</p>;

  const stale =
    detail.timeline != null &&
    detail.render != null &&
    detail.timeline.version !== detail.render.timelineVersion;
  const momentName = (momentId: string) => moments[momentId]?.description ?? momentId;
  const playheadMoment = clipAtPlayhead ? moments[clipAtPlayhead.momentId] : undefined;

  const selectClip = (clip: TimelineClip) => {
    setSelectedId(clip.id);
    transport.seek(clip.timeline.startMs);
  };
  const selectSegment = (segmentId: string) => {
    const clip = clips.find((entry) => entry.reason.segmentId === segmentId);
    if (clip) selectClip(clip);
  };
  /** A swap answers with the new timeline: show it before the reload lands. */
  const applyTimeline = (timeline: TimelineVersion) =>
    setDetail((current) => (current ? { ...current, timeline } : current));

  return (
    <>
      <div className="editor-shell">
        <EditorHeader
          detail={detail}
          latestRating={latestRating}
          actions={actions}
          onRate={(value) =>
            actions.run(
              `rate:${value}`,
              () => api.feedback(id, { kind: 'VIDEO_RATING', value }),
              `Avaliação ${value}/5 salva.`,
            )
          }
          onGenerate={() =>
            actions.run('generate', () => api.generate(id), 'Gerando uma nova timeline…')
          }
          onRender={() => actions.run('render', () => api.render(id), 'Render iniciado.')}
          onDelete={() =>
            actions.run(
              'delete',
              async () => {
                await api.deleteProject(id);
                router.push('/');
              },
              'Projeto excluído.',
              { reload: false },
            )
          }
        />

        <PipelineStatus detail={detail} failedJobs={failedJobs} stale={stale} />

        <div className="editor-body">
          <section className="panel preview">
            <div className="screen-fit">
              <Preview
                transport={transport}
                detail={detail}
                clipAtPlayhead={clipAtPlayhead}
                segment={
                  clipAtPlayhead ? segmentById.get(clipAtPlayhead.reason.segmentId) : undefined
                }
                moments={moments}
                jobsActive={jobsActive}
              />
            </div>
            <TransportBar
              transport={transport}
              clipDescription={playheadMoment?.description ?? clipAtPlayhead?.momentId ?? null}
              renderVersion={detail.render?.version ?? null}
              staleRender={stale}
              preferRender={preferRender}
              onToggleMode={() => setPreferRender((current) => !current)}
            />
          </section>

          <div className="inspector-area">
            <Inspector
              clip={selected}
              segment={segment}
              moments={moments}
              shortlist={shortlist}
              actions={actions}
              onThumb={(kind) =>
                selected &&
                actions.run(
                  kind === 'CLIP_UP' ? 'up' : 'down',
                  () => api.feedback(id, { kind, clipId: selected.id }),
                  kind === 'CLIP_UP'
                    ? 'Clipe marcado como funcionou.'
                    : 'Clipe marcado como não funcionou.',
                )
              }
              onSwap={(momentId) =>
                selected &&
                actions.run(
                  `swap:${momentId}`,
                  async () => {
                    const { timeline } = await api.swapClip(id, selected.id, momentId);
                    applyTimeline(timeline);
                  },
                  'Clipe trocado. Renderize para ver.',
                )
              }
              onBan={(momentId) =>
                actions.run(
                  `ban:${momentId}`,
                  () => api.banMoment(momentId),
                  'Momento banido. Ele não entra em novas timelines.',
                )
              }
            />
          </div>
        </div>

        <section className="panel strip-area">
          {clips.length === 0 ? (
            <div className="empty">
              {jobsActive
                ? 'O motor está montando a timeline…'
                : 'Ainda não há clipes. Gere a timeline.'}
            </div>
          ) : (
            <TimelineStrip
              clips={clips}
              durationMs={transport.durationMs}
              segments={detail.narrative}
              moments={moments}
              downbeatsMs={downbeatsMs}
              selectedId={selectedId}
              transport={transport}
              onSelect={selectClip}
            />
          )}
        </section>
      </div>

      <EditorTabs
        tab={tab}
        onTab={setTab}
        detail={detail}
        transport={transport}
        actions={actions}
        selectedSegmentId={selected?.reason.segmentId ?? null}
        momentName={momentName}
        onSelectSegment={selectSegment}
        onSetWindow={(window) =>
          actions.run(
            'window:set',
            () => api.setWindow(id, window),
            'Trecho salvo. O motor está refazendo o vídeo com ele.',
          )
        }
        onClearWindow={() =>
          actions.run(
            'window:clear',
            () => api.clearWindow(id),
            'Voltando à escolha automática. O motor está refazendo o vídeo.',
          )
        }
        onNote={(text) =>
          actions.run(
            'note',
            () => api.feedback(id, { kind: 'NOTE', note: text }),
            'Nota adicionada. O Director passa a considerá-la.',
          )
        }
      />
    </>
  );
}
