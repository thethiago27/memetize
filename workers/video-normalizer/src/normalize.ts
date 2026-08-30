import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ensureDir } from '@memetize/shared';

const execFileAsync = promisify(execFile);

export interface NormalizeParams {
  /** Absolute path to the untouched original. */
  originalPath: string;
  /** Absolute output paths. */
  proxyPath: string;
  analysisPath: string;
  thumbnailPath: string;
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ffmpeg failed: ${message}`);
  }
}

/**
 * Video Normalizer (spec section 15): turns heterogeneous inputs into
 * predictable internal formats. The comma inside `min(...)` is escaped because
 * ffmpeg's filtergraph parser treats unescaped commas as filter separators.
 */
export async function normalizeVideo(params: NormalizeParams): Promise<void> {
  await ensureDir(dirname(params.proxyPath));

  // Proxy: H.264 720p 30fps (never upscales), for future preview.
  await runFfmpeg([
    '-i',
    params.originalPath,
    '-vf',
    'scale=-2:min(720\\,ih)',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    params.proxyPath,
  ]);

  // Analysis: 480p 15fps, silent, for models and scene detection.
  await runFfmpeg([
    '-i',
    params.originalPath,
    '-vf',
    'scale=-2:min(480\\,ih)',
    '-r',
    '15',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    params.analysisPath,
  ]);

  // Thumbnail: first frame.
  await runFfmpeg(['-i', params.originalPath, '-frames:v', '1', '-q:v', '3', params.thumbnailPath]);
}
