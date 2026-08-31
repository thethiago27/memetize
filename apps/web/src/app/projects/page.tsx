'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, formatTimecode, type ProjectListRow } from '../../lib/api';
import { useInterval } from '../../lib/use-interval';

const TERMINAL = new Set(['TIMELINE_READY', 'COMPLETED', 'FAILED']);

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectListRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listProjects()
      .then((data) => setProjects(data.projects))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);
  useInterval(
    load,
    projects.some((project) => !TERMINAL.has(project.status)),
  );

  return (
    <>
      <p className="kicker">Projects</p>
      <h1 className="headline">Cue a song</h1>
      <p className="lede">
        Drop a track. The motor analyzes, matches, times and plans effects. You review the slate
        before anyone hits render.
      </p>

      <form
        className="panel file"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const audio = (form.elements.namedItem('audio') as HTMLInputElement).files?.[0];
          const lyrics = (form.elements.namedItem('lyrics') as HTMLInputElement).files?.[0];
          if (!audio) return;
          setBusy(true);
          setError(null);
          try {
            const created = await api.uploadProject(audio, lyrics);
            form.reset();
            router.push(`/projects/${created.project.id}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="audio">Audio</label>
        <input id="audio" name="audio" type="file" accept="audio/*" required />
        <label htmlFor="lyrics">Lyrics (optional .lrc / .txt)</label>
        <input id="lyrics" name="lyrics" type="file" accept=".lrc,.txt" />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Cueing…' : 'Create project'}
        </button>
      </form>

      {error ? <p className="err">{error}</p> : null}

      <section className="panel">
        {projects.length === 0 ? (
          <p className="mute">No projects yet. Cue a song to open a slate.</p>
        ) : (
          projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="row">
              <span>{project.filename}</span>
              <span className="mono mute">
                {project.status}
                {project.durationMs != null ? `  ${formatTimecode(project.durationMs)}` : ''}
                {project.timelineVersion != null ? `  tl v${project.timelineVersion}` : ''}
              </span>
            </Link>
          ))
        )}
      </section>
    </>
  );
}
