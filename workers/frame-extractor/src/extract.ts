import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ensureDir, fileExists } from '@memetize/shared';

const execFileAsync = promisify(execFile);

export interface ExtractFrameParams {
  /** Absolute path to the `analysis.mp4` (never the original, spec section 67). */
  videoPath: string;
  timestampMs: number;
  outputPath: string;
}

/** Backoff steps (ms) to nudge the seek earlier when it lands past the last decodable frame. */
const EOF_RETRY_BACKOFFS_MS = [50, 150, 350, 750];

/**
 * One frame grab is fast; a hung ffmpeg here would otherwise outlive the job's
 * 60s lease, and this runs once per sampled frame per scene. Bounded output too:
 * `-loglevel error` keeps it small, but an unbounded pipe is a way to wedge.
 */
const FFMPEG_TIMEOUT_MS = 60_000;
const FFMPEG_MAX_BUFFER = 8 * 1024 * 1024;

async function runFfmpegFrameExtract(
  videoPath: string,
  timestampMs: number,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      (timestampMs / 1000).toFixed(3),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      // mjpeg expects the full-range JPEG variant; without this, some
      // sources make ffmpeg's mjpeg encoder reject the frame outright.
      '-pix_fmt',
      'yuvj420p',
      outputPath,
    ],
    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
  );
}

/**
 * Frame Extractor (spec section 18): grabs a single JPEG frame at
 * `timestampMs`. ffmpeg can silently exit 0 without writing anything when the
 * seek lands past the last decodable frame (common right at a scene/video's
 * end, since container duration can outrun the last frame's PTS by up to one
 * frame). We verify the file landed and, if not, retry a little earlier.
 */
export async function extractFrame(params: ExtractFrameParams): Promise<void> {
  await ensureDir(dirname(params.outputPath));

  let lastError: unknown;
  for (const backoffMs of [0, ...EOF_RETRY_BACKOFFS_MS]) {
    const targetMs = Math.max(0, params.timestampMs - backoffMs);
    try {
      await runFfmpegFrameExtract(params.videoPath, targetMs, params.outputPath);
      if (await fileExists(params.outputPath)) return;
      lastError = new Error(`ffmpeg exited successfully but wrote no file at ${targetMs}ms`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`ffmpeg frame extraction failed near ${params.timestampMs}ms: ${message}`);
}
