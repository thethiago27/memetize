import type { AudioSection, BeatPoint, EnergyPoint } from '@memetize/contracts';
import {
  type AudioAnalysisRow,
  audioAnalysis,
  type Database,
  type NewAudioAnalysisRow,
} from '@memetize/database';
import { assertIntegerMs, audioAnalysisId } from '@memetize/shared';
import { and, desc, eq } from 'drizzle-orm';

export interface ReplaceAudioAnalysisParams {
  projectId: string;
  durationMs: number;
  bpm: number;
  beats: BeatPoint[];
  downbeats: number[];
  sections: AudioSection[];
  energyCurve: EnergyPoint[];
  analyzer: string;
  analyzerVersion: string;
}

/** Pure builder: enforces integer milliseconds (spec section 4.4). */
export function toAudioAnalysisRow(params: ReplaceAudioAnalysisParams): NewAudioAnalysisRow {
  return {
    id: audioAnalysisId(),
    projectId: params.projectId,
    durationMs: assertIntegerMs(params.durationMs, 'durationMs'),
    bpm: params.bpm,
    beats: params.beats.map((beat) => ({
      ...beat,
      timeMs: assertIntegerMs(beat.timeMs, 'timeMs'),
    })),
    downbeats: params.downbeats.map((timeMs) => assertIntegerMs(timeMs, 'timeMs')),
    sections: params.sections.map((section) => ({
      ...section,
      startMs: assertIntegerMs(section.startMs, 'startMs'),
      endMs: assertIntegerMs(section.endMs, 'endMs'),
    })),
    energyCurve: params.energyCurve.map((point) => ({
      ...point,
      timeMs: assertIntegerMs(point.timeMs, 'timeMs'),
    })),
    analyzer: params.analyzer,
    analyzerVersion: params.analyzerVersion,
  };
}

/**
 * Idempotently persists audio analysis: existing rows for that exact
 * project/analyzer/version combination are replaced (spec section 4.2),
 * mirroring `replaceScenes`.
 */
export async function replaceAudioAnalysis(
  db: Database,
  params: ReplaceAudioAnalysisParams,
): Promise<AudioAnalysisRow> {
  const row = toAudioAnalysisRow(params);
  return db.transaction(async (tx) => {
    await tx
      .delete(audioAnalysis)
      .where(
        and(
          eq(audioAnalysis.projectId, params.projectId),
          eq(audioAnalysis.analyzer, params.analyzer),
          eq(audioAnalysis.analyzerVersion, params.analyzerVersion),
        ),
      );
    const inserted = await tx.insert(audioAnalysis).values(row).returning();
    const persisted = inserted[0];
    if (!persisted) throw new Error('failed to insert audio analysis');
    return persisted;
  });
}

/** Most recent audio analysis for a project (spec section 39). */
export function getAudioAnalysis(
  db: Database,
  projectId: string,
): Promise<AudioAnalysisRow | undefined> {
  return db.query.audioAnalysis.findFirst({
    where: eq(audioAnalysis.projectId, projectId),
    orderBy: desc(audioAnalysis.createdAt),
  });
}
