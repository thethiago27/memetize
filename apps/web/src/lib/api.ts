const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8787';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(
      0,
      'API_UNREACHABLE',
      'A API do Studio não está respondendo na porta 8787. Inicie com pnpm studio.',
    );
  }
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error?.code ?? 'HTTP_ERROR',
      data.error?.message ?? response.statusText,
    );
  }
  return data as T;
}

export function mediaUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  return `${API_URL}/v1/media/${relativePath.replace(/^\/+/, '')}`;
}

export const api = {
  health: () => request<{ ok: boolean }>('/v1/health'),
  listAssets: () => request<{ assets: AssetRow[] }>('/v1/assets'),
  getAsset: (id: string) => request<AssetDetail>(`/v1/assets/${id}`),
  uploadAsset: (file: File, source?: string) => {
    const body = new FormData();
    body.append('file', file);
    if (source) body.append('source', source);
    return request<{ asset: AssetRow; created: boolean }>('/v1/assets', { method: 'POST', body });
  },
  listProjects: () => request<{ projects: ProjectListRow[] }>('/v1/projects'),
  getProject: (id: string) => request<ProjectDetail>(`/v1/projects/${id}`),
  uploadProject: (audio: File, lyrics?: File) => {
    const body = new FormData();
    body.append('audio', audio);
    if (lyrics) body.append('lyrics', lyrics);
    return request<{ project: ProjectRow }>('/v1/projects', { method: 'POST', body });
  },
  generate: (id: string) =>
    request<{ ok: boolean }>(`/v1/projects/${id}/generate`, { method: 'POST' }),
  render: (id: string) => request<{ ok: boolean }>(`/v1/projects/${id}/render`, { method: 'POST' }),
  swapClip: (projectId: string, clipId: string, momentId: string) =>
    request<{ timeline: { version: number } }>(`/v1/projects/${projectId}/clips/${clipId}/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ momentId }),
    }),
  feedback: (projectId: string, body: ProjectFeedbackBody) =>
    request<{ event: FeedbackEventRow }>(`/v1/projects/${projectId}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  addGlobalNote: (note: string) =>
    request<{ event: FeedbackEventRow }>('/v1/feedback/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note }),
    }),
  banMoment: (momentId: string) =>
    request<{ event: FeedbackEventRow }>(`/v1/moments/${momentId}/ban`, { method: 'POST' }),
  unbanMoment: (momentId: string) =>
    request<{ event: FeedbackEventRow }>(`/v1/moments/${momentId}/ban`, { method: 'DELETE' }),
  banAsset: (assetId: string) =>
    request<{ event: FeedbackEventRow }>(`/v1/assets/${assetId}/ban`, { method: 'POST' }),
  unbanAsset: (assetId: string) =>
    request<{ event: FeedbackEventRow }>(`/v1/assets/${assetId}/ban`, { method: 'DELETE' }),
};

export type ProjectFeedbackBody =
  | { kind: 'VIDEO_RATING'; value: number }
  | { kind: 'CLIP_UP' | 'CLIP_DOWN'; clipId: string }
  | { kind: 'NOTE'; note: string };

export interface FeedbackEventRow {
  id: string;
  projectId: string | null;
  timelineVersion: number | null;
  clipId: string | null;
  momentId: string | null;
  assetId: string | null;
  kind: string;
  value: number | null;
  note: string | null;
  context: { narrativeFunction?: string; emotion?: string };
  source: string;
  createdAt: string;
}

export interface AssetRow {
  id: string;
  filename: string;
  status: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbnailPath: string | null;
}

export interface SceneRow {
  id: string;
  startMs: number;
  endMs: number;
  frames: { timestampMs: number; path: string }[];
}

export interface AssetMomentRow {
  id: string;
  sceneId: string;
  startMs: number;
  endMs: number;
  description: string;
  primaryEmotion: string | null;
  banned: boolean;
}

export interface AssetDetail {
  asset: AssetRow;
  scenes: SceneRow[];
  moments: AssetMomentRow[];
  banned: boolean;
}

export interface MomentSummary {
  id: string;
  assetId: string;
  assetFilename: string;
  description: string;
  primaryEmotion: string | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  thumbnailPath: string | null;
}

export interface ProjectRow {
  id: string;
  filename: string;
  status: string;
}

export interface ProjectListRow extends ProjectRow {
  durationMs: number | null;
  timelineVersion: number | null;
  renderVersion: number | null;
  outputDurationMs: number | null;
  sourceStartMs: number | null;
  sourceEndMs: number | null;
}

export interface TimelineClip {
  id: string;
  momentId: string;
  timeline: { startMs: number; endMs: number };
  source: { assetId: string; startMs: number; endMs: number };
  effects: { type: string; startMs: number; endMs: number; from?: number; to?: number }[];
  reason: { segmentId: string; semanticScore: number; finalScore: number };
}

export interface ShortlistEntry {
  momentId: string;
  assetId: string;
  finalScore: number;
  penalties: string[];
}

export interface HighlightScoreBreakdown {
  section: number;
  energy: number;
  lyrics: number;
  narrativeArc: number;
  boundaries: number;
}

export interface EditWindowRow {
  id: string;
  projectId: string;
  version: number;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
  targetDurationMs: number;
  score: number;
  scoreBreakdown: HighlightScoreBreakdown;
  selector: string;
  selectorVersion: string;
  createdAt: string;
}

export interface ProjectJob {
  id: string;
  type: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ProjectDetail {
  project: ProjectRow;
  editWindow: EditWindowRow | null;
  audio: {
    durationMs: number;
    bpm: number;
    sections: { type: string; startMs: number; endMs: number }[];
  } | null;
  lyrics: { source: string; lines: { startMs: number; endMs: number; text: string }[] } | null;
  narrative: NarrativeSegmentRow[];
  matches: { segmentId: string; shortlist: ShortlistEntry[] }[];
  timeline: { version: number; data: { durationMs: number; clips: TimelineClip[] } } | null;
  render: RenderRow | null;
  renders: RenderRow[];
  jobs: ProjectJob[];
  feedback: FeedbackEventRow[];
  moments: Record<string, MomentSummary>;
}

export interface NarrativeSegmentRow {
  id: string;
  startMs: number;
  endMs: number;
  sourceKind: string;
  lyrics: string;
  meaning: string;
  emotion: string;
  narrativeFunction: string;
  visualIdeas: string[];
  energy: number;
}

export interface RenderRow {
  version: number;
  path: string;
  width: number;
  height: number;
  fps: number;
  timelineVersion: number;
  durationMs: number;
  validation: { valid: boolean; warnings: { code: string; message?: string }[] };
}

export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const frames = Math.floor((ms % 1000) / (1000 / 30));
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function hasActiveJobs(jobs: { status: string }[]): boolean {
  return jobs.some((job) => job.status === 'PENDING' || job.status === 'RUNNING');
}
