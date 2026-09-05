import { copyFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { type Database, type ProjectRow, projectAudio, projects } from '@memetize/database';
import { enqueueJob, ensureEntityExecution, stepKeyFor } from '@memetize/job-system';
import { type AppConfig, ensureDir, projectId as newProjectId, sha256File } from '@memetize/shared';
import { startProjectGeneration } from './coordinate';
import { audioDir, audioFile } from './paths';
import { probeAudio } from './probe';
import { getProject } from './projects';

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg']);

const EXT_CONTENT_TYPE: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

export interface IngestProjectArgs {
  db: Database;
  config: AppConfig;
  filePath: string;
  /** Optional user-supplied lyrics file (`.lrc` or `.txt`, spec section 26). */
  lyricsPath?: string;
  /**
   * Display name to persist, e.g. the user's original upload filename. Falls
   * back to the temp file's basename when absent (minor issue).
   */
  displayName?: string;
}

export interface IngestProjectResult {
  project: ProjectRow;
}

/**
 * Project Ingestor (spec sections 24, 39, 41): validate, checksum, copy the
 * original audio (and lyrics file, if any), probe duration, register, move
 * to `ANALYZING_AUDIO`, then fan out `AUDIO_ANALYZE` + `LYRICS` in parallel.
 *
 * Unlike asset ingestion, there is no checksum dedup: the same mp3 can seed
 * two independent projects (spec section 41 note).
 */
export async function ingestProject({
  db,
  config,
  filePath,
  lyricsPath,
  displayName,
}: IngestProjectArgs): Promise<IngestProjectResult> {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported file extension: ${ext || '(none)'}`);
  }

  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`file not found: ${filePath}`);
  }

  const checksum = await sha256File(filePath);
  const id = newProjectId();
  const dir = audioDir(config, id);
  await ensureDir(dir.absolute);

  const original = audioFile(config, id, `original${ext}`);
  await copyFile(filePath, original.absolute);

  // Fail before enqueueing anything if duration can't be probed (spec section 41).
  const probe = await probeAudio(original.absolute);

  let lyricsRelative: string | null = null;
  if (lyricsPath) {
    const lyricsStats = await stat(lyricsPath).catch(() => null);
    if (!lyricsStats?.isFile()) {
      throw new Error(`lyrics file not found: ${lyricsPath}`);
    }
    const lyricsExt = extname(lyricsPath).toLowerCase();
    // Keep the user's file as an immutable source copy, separate from the
    // normalized `generated-lyrics.lrc` the lyrics worker writes, so re-exporting
    // never clobbers lines/metadata the parser did not preserve (minor issue).
    const lyricsFile = audioFile(config, id, `source-lyrics${lyricsExt}`);
    await copyFile(lyricsPath, lyricsFile.absolute);
    lyricsRelative = lyricsFile.relative;
  }

  // Register the project, its coordination row and first generation, and the
  // fan-out jobs in one transaction (F09/F10): a crash cannot leave a project
  // with no jobs, and every job carries the generation it belongs to.
  await db.transaction(async (tx) => {
    await tx
      .insert(projects)
      .values({ id, filename: displayName ?? basename(filePath), status: 'ANALYZING_AUDIO' });
    await tx.insert(projectAudio).values({
      projectId: id,
      originalPath: original.relative,
      lyricsPath: lyricsRelative,
      checksum,
      durationMs: probe.durationMs,
      contentType: EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream',
      sizeBytes: stats.size,
    });
    await ensureEntityExecution(tx, 'project', id);
    const generationId = await startProjectGeneration(tx, id);
    await enqueueJob(tx, {
      type: 'AUDIO_ANALYZE',
      entityId: id,
      input: { projectId: id, originalPath: original.relative, durationMs: probe.durationMs },
      generationId,
      stepKey: stepKeyFor('AUDIO_ANALYZE'),
    });
    await enqueueJob(tx, {
      type: 'LYRICS',
      entityId: id,
      input: {
        projectId: id,
        lyricsPath: lyricsRelative,
        originalPath: original.relative,
        durationMs: probe.durationMs,
      },
      generationId,
      stepKey: stepKeyFor('LYRICS'),
    });
  });

  const project = await getProject(db, id);
  if (!project) throw new Error('failed to insert project');
  return { project };
}
