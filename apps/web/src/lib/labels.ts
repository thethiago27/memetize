import type { FeedbackEventRow } from './api';

export type Tone = 'ok' | 'busy' | 'bad' | 'idle';

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  CREATED: 'Criado',
  ANALYZING_AUDIO: 'Analisando áudio',
  PLANNING: 'Planejando',
  TIMELINE_READY: 'Timeline pronta',
  RENDERING: 'Renderizando',
  COMPLETED: 'Concluído',
  FAILED: 'Falhou',
};

export const ASSET_STATUS_LABEL: Record<string, string> = {
  INGESTED: 'Ingerido',
  NORMALIZING: 'Normalizando',
  ANALYZING: 'Analisando',
  INDEXING: 'Indexando',
  READY: 'Pronto',
  FAILED: 'Falhou',
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Na fila',
  RUNNING: 'Em execução',
  COMPLETED: 'Concluído',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelado',
};

export const JOB_LABEL: Record<string, string> = {
  AUDIO_ANALYZE: 'Análise de áudio',
  LYRICS: 'Letra',
  NARRATIVE: 'Narrativa',
  MATCH: 'Match',
  DIRECTOR: 'Direção',
  TIMING: 'Timing',
  EFFECTS: 'Efeitos',
  RENDER: 'Render',
  FEEDBACK_EMBED: 'Memória editorial',
  VIDEO_NORMALIZE: 'Normalização',
  SCENE_DETECT: 'Cenas',
  FRAME_EXTRACT: 'Frames',
  TRANSCRIPT: 'Transcrição',
  VISION_ANALYZE: 'Visão',
  MOMENT_EXTRACT: 'Momentos',
  EMBED: 'Índice',
};

export const PIPELINE_STEPS: { type: string; label: string }[] = [
  { type: 'AUDIO_ANALYZE', label: 'Áudio' },
  { type: 'LYRICS', label: 'Letra' },
  { type: 'NARRATIVE', label: 'Narrativa' },
  { type: 'MATCH', label: 'Match' },
  { type: 'DIRECTOR', label: 'Direção' },
  { type: 'TIMING', label: 'Timing' },
  { type: 'EFFECTS', label: 'Efeitos' },
  { type: 'RENDER', label: 'Render' },
];

export function projectTone(status: string): Tone {
  if (status === 'COMPLETED' || status === 'TIMELINE_READY') return 'ok';
  if (status === 'FAILED') return 'bad';
  if (status === 'CREATED') return 'idle';
  return 'busy';
}

export function assetTone(status: string): Tone {
  if (status === 'READY') return 'ok';
  if (status === 'FAILED') return 'bad';
  return 'busy';
}

export function jobTone(status: string): Tone {
  if (status === 'COMPLETED') return 'ok';
  if (status === 'FAILED') return 'bad';
  if (status === 'CANCELLED') return 'idle';
  return 'busy';
}

export type FunctionKey = 'setup' | 'escalation' | 'payoff' | 'other';

export function functionKey(narrativeFunction: string | undefined): FunctionKey {
  const fn = (narrativeFunction ?? '').trim().toLowerCase();
  if (fn === 'setup' || fn === 'intro' || fn === 'hook') return 'setup';
  if (fn === 'escalation' || fn === 'build' || fn === 'buildup' || fn === 'bridge') {
    return 'escalation';
  }
  if (fn === 'payoff' || fn === 'punchline' || fn === 'climax' || fn === 'drop') return 'payoff';
  return 'other';
}

export const FUNCTION_LABEL: Record<FunctionKey, string> = {
  setup: 'Preparação',
  escalation: 'Escalada',
  payoff: 'Punchline',
  other: 'Outro',
};

export function functionLabel(narrativeFunction: string | undefined): string {
  const key = functionKey(narrativeFunction);
  if (key === 'other' && narrativeFunction) return narrativeFunction;
  return FUNCTION_LABEL[key];
}

export function functionColor(narrativeFunction: string | undefined): string {
  return `var(--fn-${functionKey(narrativeFunction)})`;
}

export function describeFeedback(event: FeedbackEventRow, momentName: (id: string) => string) {
  const role = event.context.narrativeFunction
    ? ` como ${functionLabel(event.context.narrativeFunction).toLowerCase()}`
    : '';
  const moment = event.momentId ? momentName(event.momentId) : '';
  switch (event.kind) {
    case 'VIDEO_RATING':
      return `Avaliou a timeline v${event.timelineVersion ?? '?'} com ${event.value ?? '?'}/5`;
    case 'SWAP_OUT':
      return `Tirou ${moment}${role}`;
    case 'SWAP_IN':
      return `Colocou ${moment}${role}`;
    case 'CLIP_UP':
      return `Marcou ${moment} como funcionou${role}`;
    case 'CLIP_DOWN':
      return `Marcou ${moment} como não funcionou${role}`;
    case 'BAN_MOMENT':
      return `Baniu o momento ${moment}`;
    case 'UNBAN_MOMENT':
      return `Reativou o momento ${moment}`;
    case 'BAN_ASSET':
      return `Baniu o asset ${event.assetId ?? ''}`;
    case 'UNBAN_ASSET':
      return `Reativou o asset ${event.assetId ?? ''}`;
    case 'NOTE':
      return `Nota: ${event.note ?? ''}`;
    case 'PLACED':
      return `Sistema colocou ${moment}${role}`;
    default:
      return `${event.kind} ${moment}`.trim();
  }
}

export function shortName(filename: string): string {
  return filename.replace(/^memetize-upload-[0-9a-f]+\.?/i, '') || filename;
}
