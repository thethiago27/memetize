import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { secondsToMs } from '@memetize/shared';

const execFileAsync = promisify(execFile);

export interface VideoProbe {
  durationMs: number;
  width: number;
  height: number;
  fpsMilli: number;
  /** Codec name of the first video stream, e.g. `h264`; `null` when there is none. */
  videoCodec: string | null;
  /** Codec name of the first audio stream, e.g. `aac`; `null` when there is none. */
  audioCodec: string | null;
  /**
   * Duration of the first video stream in ms. Taken from the stream header when
   * ffprobe reports it, otherwise measured from the stream's packets (first pts
   * to last pts + duration); `null` only when neither is available (F07).
   */
  videoDurationMs: number | null;
  /** Duration of the first audio stream in ms, resolved the same way. */
  audioDurationMs: number | null;
  /** First presentation timestamp of the video stream in ms; `null` when unknown. */
  videoStartMs: number | null;
  /** First presentation timestamp of the audio stream in ms; `null` when unknown. */
  audioStartMs: number | null;
}

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  start_time?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

interface FfprobePacket {
  pts_time?: string;
  dts_time?: string;
  duration_time?: string;
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
  const audio = (data.streams ?? []).find((stream) => stream.codec_type === 'audio');

  const durationSeconds = Number(data.format?.duration ?? video.duration ?? 0);
  const videoSpan = await resolveStreamSpan(path, 'v:0', video);
  const audioSpan = audio ? await resolveStreamSpan(path, 'a:0', audio) : null;
  return {
    durationMs: secondsToMs(durationSeconds),
    width: Number(video.width),
    height: Number(video.height),
    fpsMilli: parseFpsMilli(video.avg_frame_rate ?? video.r_frame_rate),
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    videoDurationMs: videoSpan?.durationMs ?? null,
    audioDurationMs: audioSpan?.durationMs ?? null,
    videoStartMs: videoSpan?.startMs ?? null,
    audioStartMs: audioSpan?.startMs ?? null,
  };
}

interface StreamSpan {
  startMs: number;
  durationMs: number;
}

/**
 * A stream's real coverage. Prefers the header (`duration`, `start_time`); when
 * the container omits a usable per-stream duration, measures it from the packets
 * so an unreadable header never turns into "unknown, assume fine" (F07).
 */
async function resolveStreamSpan(
  path: string,
  selector: 'v:0' | 'a:0',
  stream: FfprobeStream,
): Promise<StreamSpan | null> {
  const headerDuration = parseSeconds(stream.duration);
  const headerStart = parseSeconds(stream.start_time);
  if (headerDuration !== null && headerDuration > 0) {
    return { startMs: secondsToMs(headerStart ?? 0), durationMs: secondsToMs(headerDuration) };
  }
  return probeStreamSpanFromPackets(path, selector);
}

/** First pts to last pts + duration over the stream's packets; `null` when unreadable. */
export async function probeStreamSpanFromPackets(
  path: string,
  selector: 'v:0' | 'a:0',
): Promise<StreamSpan | null> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        selector,
        '-show_entries',
        'packet=pts_time,dts_time,duration_time',
        '-print_format',
        'json',
        path,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch {
    return null;
  }
  const data = JSON.parse(stdout) as { packets?: FfprobePacket[] };
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const packet of data.packets ?? []) {
    const pts = parseSeconds(packet.pts_time) ?? parseSeconds(packet.dts_time);
    if (pts === null) continue;
    const duration = parseSeconds(packet.duration_time) ?? 0;
    first = Math.min(first, pts);
    last = Math.max(last, pts + duration);
  }
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  return { startMs: secondsToMs(first), durationMs: secondsToMs(last - first) };
}

function parseSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

function parseFpsMilli(rate: string | undefined): number {
  if (!rate || rate === '0/0') return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return 0;
  return Math.round((num / den) * 1000);
}
