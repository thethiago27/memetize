import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ensureDir } from '@memetize/shared';

const execFileAsync = promisify(execFile);

/**
 * Extracts a mono 16kHz WAV for transcription. Returns null when the source
 * has no audio stream — a silent/non-verbal clip is a valid input, not an
 * error (spec section 17), and the Python worker treats a null path as "no
 * speech to transcribe".
 */
export async function extractAudio(videoPath: string, outputPath: string): Promise<string | null> {
  await ensureDir(dirname(outputPath));
  try {
    await execFileAsync('ffmpeg', [
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
    ]);
    return outputPath;
  } catch {
    return null;
  }
}
