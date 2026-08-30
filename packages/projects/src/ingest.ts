import { copyFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { type Database, type ProjectRow, projectAudio, projects } from '@memetize/database';
import { enqueueJob } from '@memetize/job-system';
import { type AppConfig, ensureDir, projectId as newProjectId, sha256File } from '@memetize/shared';
import { audioDir, audioFile } from './paths';
import { probeAudio } from './probe';
import { getProject, setProjectStatus } from './projects';

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
    const lyricsFile = audioFile(config, id, `lyrics${lyricsExt}`);
    await copyFile(lyricsPath, lyricsFile.absolute);
    lyricsRelative = lyricsFile.relative;
  }

  await db.insert(projects).values({ id, filename: basename(filePath), status: 'CREATED' });
  await db.insert(projectAudio).values({
    projectId: id,
    originalPath: original.relative,
    lyricsPath: lyricsRelative,
    checksum,
    durationMs: probe.durationMs,
    contentType: EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream',
    sizeBytes: stats.size,
  });
  await setProjectStatus(db, id, 'ANALYZING_AUDIO');

  await enqueueJob(db, {
    type: 'AUDIO_ANALYZE',
    entityId: id,
    input: { projectId: id, originalPath: original.relative, durationMs: probe.durationMs },
  });
  await enqueueJob(db, {
    type: 'LYRICS',
    entityId: id,
    input: {
      projectId: id,
      lyricsPath: lyricsRelative,
      originalPath: original.relative,
      durationMs: probe.durationMs,
    },
  });

  const project = await getProject(db, id);
  if (!project) throw new Error('failed to insert project');
  return { project };
}
