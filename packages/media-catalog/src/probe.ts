import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { secondsToMs } from '@memetize/shared';

const execFileAsync = promisify(execFile);

export interface VideoProbe {
  durationMs: number;
  width: number;
  height: number;
  fpsMilli: number;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

/** Probes technical metadata with ffprobe. All times returned as integer ms. */
export async function probeVideo(path: string): Promise<VideoProbe> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ffprobe failed for ${path}: ${message}`);
  }

  const data = JSON.parse(stdout) as FfprobeOutput;
  const video = (data.streams ?? []).find((stream) => stream.codec_type === 'video');
  if (!video || video.width === undefined || video.height === undefined) {
    throw new Error(`no video stream found in ${path}`);
  }

  const durationSeconds = Number(data.format?.duration ?? video.duration ?? 0);
  return {
    durationMs: secondsToMs(durationSeconds),
    width: Number(video.width),
    height: Number(video.height),
    fpsMilli: parseFpsMilli(video.avg_frame_rate ?? video.r_frame_rate),
  };
}

function parseFpsMilli(rate: string | undefined): number {
  if (!rate || rate === '0/0') return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return 0;
  return Math.round((num / den) * 1000);
}
