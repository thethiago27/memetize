import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { secondsToMs } from '@memetize/shared';

const execFileAsync = promisify(execFile);

export interface AudioProbe {
  durationMs: number;
}

interface FfprobeOutput {
  format?: { duration?: string };
}

/**
 * Probes an audio file's duration with ffprobe. Used at ingest time so a
 * file with no readable duration fails fast, before any job is enqueued
 * (spec section 41).
 */
export async function probeAudio(path: string): Promise<AudioProbe> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', path],
      { maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ffprobe failed for ${path}: ${message}`);
  }

  const data = JSON.parse(stdout) as FfprobeOutput;
  const durationSeconds = Number(data.format?.duration ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`no duration found in ${path}`);
  }

  return { durationMs: secondsToMs(durationSeconds) };
}
