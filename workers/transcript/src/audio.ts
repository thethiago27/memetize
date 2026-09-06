import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ensureDir } from '@memetize/shared';

const execFileAsync = promisify(execFile);

/**
 * Audio extraction is a full decode of the source, so it gets the same bound as
 * the normalizer's passes: without one, a hung ffmpeg outlives the job's lease
 * and the worker waits on it forever.
 */
const FFMPEG_TIMEOUT_MS = 180_000;
const FFMPEG_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Extracts a mono 16kHz WAV for transcription. Returns null when the source
 * has no audio stream — a silent/non-verbal clip is a valid input, not an
 * error (spec section 17), and the Python worker treats a null path as "no
 * speech to transcribe".
 */
export async function extractAudio(videoPath: string, outputPath: string): Promise<string | null> {
  await ensureDir(dirname(outputPath));
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        videoPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        outputPath,
      ],
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
    return outputPath;
  } catch {
    return null;
  }
}
