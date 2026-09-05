import type {
  ClipStyle,
  CutDowngradeReason,
  FeedbackEventRow,
  TimelineClip,
  TransitionStyle,
} from './api';

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
  SUBTITLES: 'Legendas',
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
  { type: 'SUBTITLES', label: 'Legendas' },
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

/** Musical sections emitted by the audio analyzer. Unknown types keep their raw name. */
export const SECTION_LABEL: Record<string, string> = {
  intro: 'Intro',
  verse: 'Verso',
  chorus: 'Refrão',
  bridge: 'Ponte',
  outro: 'Final',
  drop: 'Drop',
  break: 'Pausa',
};

export function sectionLabel(type: string): string {
  return SECTION_LABEL[type.toLowerCase()] ?? type;
}

/** One fixed hue per section type so the same type reads the same across projects. */
const SECTION_COLOR: Record<string, string> = {
  intro: 'var(--fn-other)',
  verse: 'var(--fn-setup)',
  chorus: 'var(--fn-payoff)',
  bridge: 'var(--fn-escalation)',
  outro: 'var(--mute)',
  drop: 'var(--cut)',
  break: 'var(--tape)',
};

export function sectionColor(type: string): string {
  return SECTION_COLOR[type.toLowerCase()] ?? 'var(--fn-other)';
}

export const LYRIC_SOURCE_LABEL: Record<string, string> = {
  USER: 'Letra do usuário',
  TRANSCRIPT: 'Letra transcrita',
  FIXTURE: 'Letra de fixture',
};

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

// --- Cut styles (cut-styles spec) ----------------------------------------

export const TRANSITION_STYLE_LABEL: Record<TransitionStyle, string> = {
  hard: 'corte seco',
  dip_black: 'dip to black',
  flash: 'flash',
  crossfade: 'crossfade',
  whip: 'whip',
};

export const CLIP_STYLE_LABEL: Record<ClipStyle, string> = {
  none: 'nenhum',
  hold: 'hold',
  speed_up: 'acelerado',
  slow_down: 'câmera lenta',
};

export const CUT_DOWNGRADE_LABEL: Record<CutDowngradeReason, string> = {
  no_source_handle: 'a fonte não tinha margem',
  slot_too_short: 'o clipe é curto demais',
  overlapping_transitions: 'a transição de entrada já ocupa o clipe',
  last_clip: 'é o último clipe',
};

export interface CutSummary {
  /** "Saída: crossfade, 300 ms" */
  transition: string;
  /** "Pedido: crossfade. Ficou dip to black porque a fonte não tinha margem." */
  downgrade: string | null;
  /** Human labels for the clip's effects, e.g. ["hold 500 ms", "acelerado", "zoom"]. */
  effects: string[];
  /** Effects the Director asked for that were dropped. */
  droppedStyle: string | null;
}

export function describeCut(clip: TimelineClip): CutSummary {
  const out = clip.transitionOut;
  const transition = out
    ? out.style === 'hard'
      ? `Saída: ${TRANSITION_STYLE_LABEL.hard}`
      : `Saída: ${TRANSITION_STYLE_LABEL[out.style]}, ${out.durationMs} ms`
    : 'Saída: corte seco';
  const downgrade =
    out?.downgradeReason && out.requested !== out.style
      ? `Pedido: ${TRANSITION_STYLE_LABEL[out.requested]}. Ficou ${TRANSITION_STYLE_LABEL[out.style]} porque ${CUT_DOWNGRADE_LABEL[out.downgradeReason]}.`
      : null;

  const effects = clip.effects.map(effectLabel).filter((label): label is string => label !== null);
  const requested = clip.direction?.clipStyle ?? 'none';
  const kept = clip.effects.some((effect) => effect.requested === requested);
  // The reason for a dropped clip style lives only in the Effects debug file.
  const droppedStyle =
    requested !== 'none' && !kept
      ? `Pedido: ${CLIP_STYLE_LABEL[requested]}. Não entrou neste clipe.`
      : null;

  return { transition, downgrade, effects, droppedStyle };
}

export function effectLabel(effect: TimelineClip['effects'][number]): string | null {
  if (effect.type === 'zoom') return 'zoom';
  if (effect.type === 'hold') return `hold ${effect.endMs - effect.startMs} ms`;
  if (effect.type === 'speed') {
    const factor = effect.factor ?? 1;
    return factor >= 1 ? `acelerado ${factor}×` : `câmera lenta ${factor}×`;
  }
  return null;
}

/** Short badge for the strip; `null` when the clip has no visible style. */
export function effectBadge(clip: TimelineClip): string | null {
  const parts: string[] = [];
  for (const effect of clip.effects) {
    if (effect.type === 'hold') parts.push('HOLD');
    else if (effect.type === 'speed') parts.push(`${effect.factor ?? 1}×`);
    else if (effect.type === 'zoom') parts.push('ZOOM');
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
