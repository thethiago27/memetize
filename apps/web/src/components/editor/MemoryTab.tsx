'use client';

import { useState } from 'react';
import type { FeedbackEventRow } from '../../lib/api';
import { describeFeedback } from '../../lib/labels';

/** Note input and the project's editorial memory, in Portuguese. */
export function MemoryTab({
  feedback,
  momentName,
  saving,
  onNote,
}: {
  feedback: FeedbackEventRow[];
  momentName: (momentId: string) => string;
  saving: boolean;
  /** Resolves `true` when the note was saved; the input clears then. */
  onNote: (text: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  return (
    <>
      <form
        className="cluster"
        onSubmit={async (event) => {
          event.preventDefault();
          const text = note.trim();
          if (!text) return;
          if (await onNote(text)) setNote('');
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
        <button className="btn" type="submit" disabled={saving || !note.trim()}>
          {saving ? 'Salvando…' : 'Adicionar nota'}
        </button>
      </form>
      {feedback.length === 0 ? (
        <p className="mute">Nada aprendido ainda. Troque, avalie ou anote para ensinar o motor.</p>
      ) : (
        feedback.map((event) => (
          <div key={event.id} className="row">
            <span className="small">
              {describeFeedback(event, momentName)}
              {event.projectId === null ? <span className="mute"> · global</span> : null}
            </span>
            <span className="mono mute">{new Date(event.createdAt).toLocaleString('pt-BR')}</span>
          </div>
        ))
      )}
    </>
  );
}
