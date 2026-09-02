import type { RenderWarning } from '@memetize/contracts';

/**
 * `packages/renderer`'s own contracts (spec sections 37-39): kept separate
 * from `@memetize/contracts` because these shapes are internal to the
 * validate → build-graph → probe pipeline, never serialized as job I/O.
 */

export interface TimelineIssue {
  code:
    | 'CLIP_OVERLAP'
    | 'CLIP_OUT_OF_BOUNDS'
    | 'INVALID_RANGE'
    | 'EMPTY_TIMELINE'
    | 'TIMELINE_GAP'
    | 'SOURCE_SHORTER_THAN_SLOT'
    | 'TIMELINE_DURATION_MISMATCH'
    | 'TRANSITION_TOO_LONG'
    | 'TRANSITION_HANDLE_OUT_OF_BOUNDS'
    | 'OVERLAPPING_TRANSITIONS';
  message: string;
  clipId?: string;
}

export interface TimelineValidation {
  ok: boolean;
  errors: TimelineIssue[];
  warnings: RenderWarning[];
}

/** One clip's source resolved to an absolute, on-disk video path. */
export interface ResolvedClip {
  clipId: string;
  /** Absolute path. */
  videoPath: string;
}

export interface ResolvedAssets {
  /** Absolute path. */
  audioPath: string;
  audioDurationMs: number;
  clips: readonly ResolvedClip[];
}

export interface FfmpegInput {
  path: string;
  kind: 'audio' | 'video';
}

export interface FfmpegGraph {
  inputs: FfmpegInput[];
  filterComplex: string;
  /** Everything after `-filter_complex ...` except the output path. */
  outputArgs: string[];
  durationMs: number;
}

/** ffprobe's technical read of the rendered MP4 (spec section 38). */
export interface OutputProbe {
  exists: boolean;
  durationMs: number;
  width: number;
  height: number;
  fpsMilli: number;
  videoCodec: string | null;
  audioCodec: string | null;
}
