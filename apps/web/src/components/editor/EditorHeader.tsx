'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatTimecode, type ProjectDetail } from '../../lib/api';
import { PROJECT_STATUS_LABEL, projectTone, shortName } from '../../lib/labels';
import type { EditorActions } from '../../lib/use-editor-actions';
import { Dialog } from '../Dialog';
import { StatusPill } from '../StatusPill';

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * One line at the top of the editor: back, title, status and meta on the
 * left; rating and the project actions on the right. Kept short so the
 * preview and the strip get the viewport (editor-transport spec).
 */
export function EditorHeader({
  detail,
  latestRating,
  actions,
  onRate,
  onGenerate,
  onRender,
  onDelete,
}: {
  detail: ProjectDetail;
  latestRating: number | null;
  actions: EditorActions;
  onRate: (value: number) => void;
  onGenerate: () => void;
  onRender: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const name = shortName(detail.project.filename);
  const meta = [
    detail.audio
      ? `${formatTimecode(detail.audio.durationMs)} · ${Math.round(detail.audio.bpm)} bpm`
      : 'aguardando análise',
    detail.editWindow
      ? `trecho ${formatTimecode(detail.editWindow.sourceStartMs)}–${formatTimecode(detail.editWindow.sourceEndMs)}`
      : null,
    detail.timeline ? `timeline v${detail.timeline.version}` : null,
    detail.render ? `render v${detail.render.version}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <div className="editor-head">
        <div className="editor-head-main">
          <Link className="back" href="/" aria-label="Voltar aos projetos">
            ←
          </Link>
          <h1 className="headline headline-sm" title={detail.project.filename}>
            {name}
          </h1>
          <StatusPill
            label={PROJECT_STATUS_LABEL[detail.project.status] ?? detail.project.status}
            tone={projectTone(detail.project.status)}
          />
          <span className="mono mute small editor-meta">{meta}</span>
        </div>
        <div className="cluster">
          {detail.timeline ? (
            <span className="cluster" title="Avaliar este corte ensina o ranker o que funcionou">
              <span className="mute small">Avaliar</span>
              <span className="rating">
                {RATINGS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="star"
                    data-on={latestRating !== null && value <= latestRating ? 'true' : 'false'}
                    aria-label={`${value} de 5`}
                    disabled={actions.isBusy(`rate:${value}`)}
                    onClick={() => onRate(value)}
                  >
                    ★
                  </button>
                ))}
              </span>
            </span>
          ) : null}
          <button
            className="btn btn-sm"
            type="button"
            disabled={actions.timelineLocked}
            onClick={onGenerate}
          >
            {actions.isBusy('generate') ? 'Gerando…' : 'Gerar timeline'}
          </button>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            disabled={actions.isBusy('render') || actions.timelineLocked || !detail.timeline}
            onClick={onRender}
          >
            {actions.isBusy('render') ? 'Renderizando…' : 'Renderizar'}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            title="Excluir este projeto"
            disabled={actions.isBusy('delete')}
            onClick={() => setConfirmDelete(true)}
          >
            Excluir
          </button>
        </div>
      </div>

      {confirmDelete ? (
        <Dialog
          labelledBy="delete-title"
          onClose={() => {
            if (!actions.isBusy('delete')) setConfirmDelete(false);
          }}
        >
          <h2 className="section-title" id="delete-title">
            Excluir projeto?
          </h2>
          <p>
            <strong>{name}</strong> será removido com a música, a análise, as timelines e os
            renders. Isso não pode ser desfeito.
          </p>
          <p className="hint">
            A memória editorial (avaliações, trocas, notas) é mantida para os próximos projetos.
          </p>
          <div className="cluster cluster-end">
            <button
              className="btn btn-ghost"
              type="button"
              disabled={actions.isBusy('delete')}
              onClick={() => setConfirmDelete(false)}
            >
              Cancelar
            </button>
            <button
              className="btn btn-danger"
              type="button"
              disabled={actions.isBusy('delete')}
              onClick={async () => {
                const ok = await onDelete();
                if (!ok) setConfirmDelete(false);
              }}
            >
              {actions.isBusy('delete') ? 'Excluindo…' : 'Excluir projeto'}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
