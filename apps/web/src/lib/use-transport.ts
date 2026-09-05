'use client';

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderRow, TimelineVersion } from './api';
import { outputToSourceMs, sourceToOutputMs } from './storyboard-clock';

/**
 * The editor's one clock (editor-transport spec). Strip, preview and the
 * Análise tab read `positionMs` from here and never touch a media element.
 *
 * - `render`: drives the `<video>` of the rendered MP4.
 * - `storyboard`: drives a hidden `<audio>` with the project's music; the
 *   preview shows the thumbnail of the clip under the playhead.
 * - `none`: nothing to play yet.
 */
export type TransportMode = 'render' | 'storyboard' | 'none';

export interface TransportInput {
  timeline: TimelineVersion | null;
  render: RenderRow | null;
  /** The editor asked to watch a stale render instead of the storyboard. */
  preferRender: boolean;
}

export interface Transport {
  mode: TransportMode;
  /** Output clock, `0..durationMs`. */
  positionMs: number;
  playing: boolean;
  durationMs: number;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Moves the clock and the media element. Clamps to `[0, durationMs]`. */
  seek(ms: number): void;
  /**
   * Moves only the clock, for the middle of a drag: the strip and the
   * storyboard follow it for free, and the media element seeks once, on
   * `seek`, when the drag ends. Seeking a video on every pointer move
   * stalls it.
   */
  scrub(ms: number): void;
  /** The element this transport drives; `Preview` attaches it. */
  mediaRef: RefObject<HTMLMediaElement | null>;
  /** Callback ref for the active media element. Seeks it to the current position on mount. */
  attachMedia(element: HTMLMediaElement | null): void;
  /** The media element reached its own end. */
  onEnded(): void;
}

export function resolveMode(input: TransportInput): TransportMode {
  const { timeline, render, preferRender } = input;
  if (render && (!timeline || render.timelineVersion === timeline.version || preferRender)) {
    return 'render';
  }
  if (timeline) return 'storyboard';
  return 'none';
}

export function useTransport(input: TransportInput): Transport {
  const mode = resolveMode(input);
  const audio = input.timeline?.data.audio ?? null;
  const durationMs = input.timeline?.data.durationMs ?? input.render?.durationMs ?? 0;

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const positionRef = useRef(0);
  const [positionMs, setPositionState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<number | null>(null);

  // Primitive deps: every project reload builds a new `audio` object, and the
  // callbacks below must not change identity on each one, or the media
  // element would be re-attached (and re-seeked) every poll.
  const storyboard = mode === 'storyboard' && audio !== null;
  const sourceStartMs = audio?.sourceStartMs ?? 0;
  const timelineStartMs = audio?.timelineStartMs ?? 0;

  /** Output ms → seconds on the element this mode drives. */
  const toMediaSeconds = useCallback(
    (ms: number) =>
      (storyboard ? outputToSourceMs(ms, { sourceStartMs, timelineStartMs }) : ms) / 1000,
    [storyboard, sourceStartMs, timelineStartMs],
  );
  const fromMediaSeconds = useCallback(
    (seconds: number) => {
      const ms = Math.round(seconds * 1000);
      return storyboard ? sourceToOutputMs(ms, { sourceStartMs, timelineStartMs }) : ms;
    },
    [storyboard, sourceStartMs, timelineStartMs],
  );

  const setPosition = useCallback(
    (ms: number) => {
      const clamped = Math.min(durationMs, Math.max(0, ms));
      positionRef.current = clamped;
      setPositionState(clamped);
    },
    [durationMs],
  );

  const stopFrames = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    const media = mediaRef.current;
    if (media) {
      media.pause();
      setPosition(fromMediaSeconds(media.currentTime));
    }
    setPlaying(false);
  }, [fromMediaSeconds, setPosition]);

  const seek = useCallback(
    (ms: number) => {
      setPosition(ms);
      const media = mediaRef.current;
      if (media) media.currentTime = toMediaSeconds(positionRef.current);
    },
    [setPosition, toMediaSeconds],
  );

  const scrub = useCallback((ms: number) => setPosition(ms), [setPosition]);

  const play = useCallback(() => {
    if (mode === 'none') return;
    const media = mediaRef.current;
    if (!media) return;
    if (positionRef.current >= durationMs) setPosition(0);
    media.currentTime = toMediaSeconds(positionRef.current);
    void media.play().catch(() => setPlaying(false));
    setPlaying(true);
  }, [mode, durationMs, setPosition, toMediaSeconds]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, pause, play]);

  const onEnded = useCallback(() => {
    setPlaying(false);
    setPosition(durationMs);
  }, [durationMs, setPosition]);

  const attachMedia = useCallback(
    (element: HTMLMediaElement | null) => {
      mediaRef.current = element;
      if (element) element.currentTime = toMediaSeconds(positionRef.current);
    },
    [toMediaSeconds],
  );

  // Changing mode swaps the media element; keep the position, drop playback.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on mode change only
  useEffect(() => {
    setPlaying(false);
  }, [mode]);

  // A new timeline may be shorter than the parked position.
  useEffect(() => {
    if (positionRef.current > durationMs) setPosition(durationMs);
  }, [durationMs, setPosition]);

  // While playing, follow the media clock frame by frame; the storyboard
  // stops itself at `durationMs` because the music keeps going past it.
  useEffect(() => {
    if (!playing) {
      stopFrames();
      return;
    }
    const tick = () => {
      const media = mediaRef.current;
      if (media) {
        const ms = fromMediaSeconds(media.currentTime);
        if (ms >= durationMs) {
          media.pause();
          setPosition(durationMs);
          setPlaying(false);
          return;
        }
        setPosition(ms);
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return stopFrames;
  }, [playing, durationMs, fromMediaSeconds, setPosition, stopFrames]);

  return useMemo(
    () => ({
      mode,
      positionMs,
      playing,
      durationMs,
      play,
      pause,
      toggle,
      seek,
      scrub,
      mediaRef,
      attachMedia,
      onEnded,
    }),
    [mode, positionMs, playing, durationMs, play, pause, toggle, seek, scrub, attachMedia, onEnded],
  );
}
