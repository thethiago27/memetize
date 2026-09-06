'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { StatusPill } from '../components/StatusPill';
import { useToast } from '../components/Toast';
import { api, formatTimecode, type ProjectListRow } from '../lib/api';
import { PROJECT_STATUS_LABEL, projectTone, shortName } from '../lib/labels';
import { useInterval } from '../lib/use-interval';

const TERMINAL = new Set(['TIMELINE_READY', 'COMPLETED', 'FAILED']);

export default function ProjectsPage() {
  const router = useRouter();
  const { notify } = useToast();
  const [projects, setProjects] = useState<ProjectListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listProjects()
      .then((data) => {
        setProjects(data.projects);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);
  useInterval(
    load,
    (projects ?? []).some((project) => !TERMINAL.has(project.status)),
  );

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="headline">Projetos</h1>
          <p className="lede">
            Cada projeto parte de uma música. O motor analisa, escolhe os cortes e monta a timeline;
            você revisa, troca clipes e renderiza.
          </p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setOpen(true)}>
          Novo projeto
        </button>
      </div>

      {error ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}

      {projects === null ? (
        <div className="grid" role="status" aria-label="Carregando projetos">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
            <div key={key} className="card skeleton" aria-hidden="true">
              <span className="skel skel-title" />
              <span className="skel skel-meta" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="empty">Nenhum projeto ainda. Crie um a partir de uma música.</div>
      ) : (
        <div className="grid">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="card">
              <div className="cluster cluster-spread">
                <StatusPill
                  label={PROJECT_STATUS_LABEL[project.status] ?? project.status}
                  tone={projectTone(project.status)}
                />
                <span className="mono mute">
                  {project.renderVersion != null
                    ? `render v${project.renderVersion}`
                    : 'sem render'}
                </span>
              </div>
              <div className="card-title">{shortName(project.filename)}</div>
              <div className="mono mute">
                {project.durationMs != null ? `música ${formatTimecode(project.durationMs)}` : ''}
                {project.outputDurationMs != null
                  ? ` · saída ${formatTimecode(project.outputDurationMs)}`
                  : ''}
                {project.timelineVersion != null ? ` · timeline v${project.timelineVersion}` : ''}
              </div>
            </Link>
          ))}
        </div>
      )}

      {open ? (
        <Dialog
          as="form"
          labelledBy="new-project-title"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const audio = (form.elements.namedItem('audio') as HTMLInputElement).files?.[0];
            const lyrics = (form.elements.namedItem('lyrics') as HTMLInputElement).files?.[0];
            if (!audio) return;
            setBusy(true);
            try {
              const created = await api.uploadProject(audio, lyrics);
              notify('Projeto criado. O motor já começou a análise.');
              router.push(`/projects/${created.project.id}`);
            } catch (err) {
              notify(err instanceof Error ? err.message : String(err), 'bad');
              setBusy(false);
            }
          }}
        >
          <h2 className="section-title" id="new-project-title">
            Novo projeto
          </h2>
          <div className="field">
            <label htmlFor="audio">Música (mp3, wav)</label>
            <input
              className="input"
              id="audio"
              name="audio"
              type="file"
              accept="audio/*"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="lyrics">Letra sincronizada (.lrc ou .txt, opcional)</label>
            <input className="input" id="lyrics" name="lyrics" type="file" accept=".lrc,.txt" />
          </div>
          <p className="hint">
            Músicas com mais de 30 segundos viram um trecho contínuo de 30 segundos escolhido pelo
            motor.
          </p>
          <div className="cluster cluster-end">
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Enviando…' : 'Criar projeto'}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
