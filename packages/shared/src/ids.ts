import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const nano = customAlphabet(ALPHABET, 21);

export type IdPrefix =
  | 'ast'
  | 'scn'
  | 'job'
  | 'mom'
  | 'seg'
  | 'emb'
  | 'prj'
  | 'nar'
  | 'aud'
  | 'lyr'
  | 'mat';

/** Builds a URL-safe, sortable-enough id like `ast_9x3k...`. */
export function prefixedId(prefix: IdPrefix): string {
  return `${prefix}_${nano()}`;
}

export const assetId = (): string => prefixedId('ast');
export const sceneId = (): string => prefixedId('scn');
export const jobId = (): string => prefixedId('job');
export const momentId = (): string => prefixedId('mom');
export const segmentId = (): string => prefixedId('seg');
export const embeddingId = (): string => prefixedId('emb');
export const projectId = (): string => prefixedId('prj');
export const narrativeId = (): string => prefixedId('nar');
export const audioAnalysisId = (): string => prefixedId('aud');
export const lyricsId = (): string => prefixedId('lyr');
export const matchId = (): string => prefixedId('mat');
