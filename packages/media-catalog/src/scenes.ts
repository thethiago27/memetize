import type { ExtractedFrame, VisionSceneAnalysis } from '@memetize/contracts';
import { type Database, type NewSceneRow, type SceneRow, scenes } from '@memetize/database';
import { assertIntegerMs, sceneId } from '@memetize/shared';
import { and, asc, eq } from 'drizzle-orm';

export interface SceneInput {
  startMs: number;
  endMs: number;
}

export interface ReplaceScenesParams {
  assetId: string;
  detector: string;
  detectorVersion: string;
  scenes: SceneInput[];
}

/**
 * Pure builder: turns detected intervals into scene rows, enforcing integer
 * milliseconds (spec section 4.4). Extracted so time validation is unit-testable
 * without a database.
 */
export function toSceneRows(params: ReplaceScenesParams): NewSceneRow[] {
  return params.scenes.map((scene) => {
    const startMs = assertIntegerMs(scene.startMs, 'startMs');
    const endMs = assertIntegerMs(scene.endMs, 'endMs');
    return {
      id: sceneId(),
      assetId: params.assetId,
      startMs,
      endMs,
      durationMs: assertIntegerMs(endMs - startMs, 'durationMs'),
      detector: params.detector,
      detectorVersion: params.detectorVersion,
    };
  });
}

/**
 * Idempotently persists scenes for an asset/detector/version: existing rows for
 * that exact combination are replaced, so re-running the detector never
 * duplicates scenes (spec section 4.2).
 */
export async function replaceScenes(
  db: Database,
  params: ReplaceScenesParams,
): Promise<SceneRow[]> {
  const rows = toSceneRows(params);
  return db.transaction(async (tx) => {
    await tx
      .delete(scenes)
      .where(
        and(
          eq(scenes.assetId, params.assetId),
          eq(scenes.detector, params.detector),
          eq(scenes.detectorVersion, params.detectorVersion),
        ),
      );
    if (rows.length === 0) return [];
    return tx.insert(scenes).values(rows).returning();
  });
}

export function listScenes(db: Database, assetId: string): Promise<SceneRow[]> {
  return db.query.scenes.findMany({
    where: eq(scenes.assetId, assetId),
    orderBy: asc(scenes.startMs),
  });
}

export function getScene(db: Database, id: string): Promise<SceneRow | undefined> {
  return db.query.scenes.findFirst({ where: eq(scenes.id, id) });
}

/** Frame Extractor output: persists the sampled frames for one scene. */
export async function updateSceneFrames(
  db: Database,
  sceneRowId: string,
  frames: ExtractedFrame[],
): Promise<void> {
  await db.update(scenes).set({ frames }).where(eq(scenes.id, sceneRowId));
}

/** Vision Analyzer output: persists the structured analysis for one scene. */
export async function updateSceneVision(
  db: Database,
  sceneRowId: string,
  params: { vision: VisionSceneAnalysis; visionModel: string; visionVersion: string },
): Promise<void> {
  await db
    .update(scenes)
    .set({
      vision: params.vision,
      visionModel: params.visionModel,
      visionVersion: params.visionVersion,
    })
    .where(eq(scenes.id, sceneRowId));
}
