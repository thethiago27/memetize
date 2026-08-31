import type { TimelineCanvas, TimelineClip, TimelineEffect } from '@memetize/timeline';

export interface ParsedZoom {
  startMs: number;
  endMs: number;
  from: number;
  to: number;
}

/**
 * A zoom the graph can actually apply: numeric `from`/`to` > 0 and a
 * window strictly inside the clip's timeline slot. Anything else is
 * ignored at encode time and surfaces as `UNKNOWN_EFFECT`.
 */
export function parseZoomEffect(effect: TimelineEffect, clip: TimelineClip): ParsedZoom | null {
  if (effect.type !== 'zoom') return null;
  const from = effect.from;
  const to = effect.to;
  if (typeof from !== 'number' || typeof to !== 'number' || from <= 0 || to <= 0) return null;
  if (effect.startMs >= effect.endMs) return null;
  if (effect.startMs < clip.timeline.startMs || effect.endMs > clip.timeline.endMs) return null;
  return { startMs: effect.startMs, endMs: effect.endMs, from, to };
}

export function isRenderableZoom(effect: TimelineEffect, clip: TimelineClip): boolean {
  return parseZoomEffect(effect, clip) !== null;
}

/**
 * Ken Burns via `scale`+`crop` with `eval=frame` (spec §57). `t` is zero at
 * the clip start after `setpts`, so the effect window is converted to local
 * seconds. Commas in the expression are escaped for `filter_complex`.
 */
export function buildZoomFilter(
  zoom: ParsedZoom,
  clip: TimelineClip,
  canvas: TimelineCanvas,
): string {
  const localStartS = toSeconds(zoom.startMs - clip.timeline.startMs);
  const localEndS = toSeconds(zoom.endMs - clip.timeline.startMs);
  const z =
    `if(lt(t\\,${localStartS})\\,${zoom.from}\\,` +
    `if(gt(t\\,${localEndS})\\,${zoom.to}\\,` +
    `${zoom.from}+(${zoom.to}-${zoom.from})*(t-${localStartS})/(${localEndS}-${localStartS})))`;
  const { width, height } = canvas;
  return (
    `scale=w='iw*(${z})':h='ih*(${z})':eval=frame,` +
    `crop=${width}:${height}:x='(iw-${width})/2':y='(ih-${height})/2'`
  );
}

function toSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}
