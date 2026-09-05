'use client';

import type { ManualWindow, ProjectDetail } from '../../lib/api';
import type { EditorActions } from '../../lib/use-editor-actions';
import type { Transport } from '../../lib/use-transport';
import { AnalysisPanel } from '../AnalysisPanel';
import { JobsTab } from './JobsTab';
import { MemoryTab } from './MemoryTab';
import { NarrativeTab } from './NarrativeTab';
import { RendersTab } from './RendersTab';

export type EditorTab = 'narrativa' | 'analise' | 'renders' | 'memoria' | 'jobs';

const TABS: [EditorTab, string][] = [
  ['narrativa', 'Narrativa'],
  ['analise', 'Análise'],
  ['renders', 'Renders'],
  ['memoria', 'Memória editorial'],
  ['jobs', 'Jobs'],
];

export function EditorTabs({
  tab,
  onTab,
  detail,
  transport,
  actions,
  selectedSegmentId,
  momentName,
  onSelectSegment,
  onSetWindow,
  onClearWindow,
  onNote,
}: {
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  detail: ProjectDetail;
  transport: Transport;
  actions: EditorActions;
  selectedSegmentId: string | null;
  momentName: (momentId: string) => string;
  onSelectSegment: (segmentId: string) => void;
  onSetWindow: (window: ManualWindow) => Promise<boolean>;
  onClearWindow: () => Promise<boolean>;
  onNote: (text: string) => Promise<boolean>;
}) {
  return (
    <section className="panel">
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            className="tab"
            data-active={tab === key ? 'true' : 'false'}
            onClick={() => onTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'narrativa' ? (
        <NarrativeTab
          segments={detail.narrative}
          selectedSegmentId={selectedSegmentId}
          onSelectSegment={onSelectSegment}
        />
      ) : null}

      {tab === 'analise' ? (
        <AnalysisPanel
          audio={detail.audio}
          lyrics={detail.lyrics}
          subtitles={detail.subtitles ?? null}
          editWindow={detail.editWindow}
          manualWindow={detail.manualWindow ?? null}
          positionMs={transport.positionMs}
          locked={actions.timelineLocked}
          onSeek={transport.seek}
          onSetWindow={onSetWindow}
          onClearWindow={onClearWindow}
        />
      ) : null}

      {tab === 'renders' ? <RendersTab renders={detail.renders ?? []} /> : null}

      {tab === 'memoria' ? (
        <MemoryTab
          feedback={detail.feedback ?? []}
          momentName={momentName}
          saving={actions.isBusy('note')}
          onNote={onNote}
        />
      ) : null}

      {tab === 'jobs' ? <JobsTab jobs={detail.jobs} /> : null}
    </section>
  );
}
