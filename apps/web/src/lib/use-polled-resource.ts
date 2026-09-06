'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Slowest the poll backs off to while the API keeps failing. */
const MAX_INTERVAL_MS = 30_000;

export interface PolledResource<T> {
  data: T | null;
  error: string | null;
  /** Fetch again now, e.g. after an action the user took. */
  reload: () => void;
  /**
   * Apply a local update before the next load lands — for an action whose
   * response already carries the new state. The next poll overwrites it, which
   * is the point: it is a preview of what the server just accepted.
   */
  mutate: (updater: (current: T | null) => T | null) => void;
}

/**
 * Loads a resource and keeps polling it while `shouldPoll` says the server side
 * is still moving. Every page in the Studio needs the same three things, and
 * each used to hand-roll them:
 *
 * - **A sequence guard.** Responses are applied only if no newer request has
 *   started. Navigating between projects could otherwise let a slow response
 *   for the previous id overwrite the new one's state.
 * - **Backoff.** A failing API was re-polled every 1.5s forever; the interval
 *   now doubles up to 30s and resets on the first success.
 * - **A hidden-tab pause.** A background tab stops polling and refreshes once
 *   when it comes back, instead of hammering the API unseen.
 */
export function usePolledResource<T>(
  fetcher: () => Promise<T>,
  shouldPoll: (data: T | null) => boolean,
  baseIntervalMs = 1500,
): PolledResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bumped per request; a response whose ticket is stale is dropped.
  const ticketRef = useRef(0);
  const intervalRef = useRef(baseIntervalMs);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(() => {
    ticketRef.current += 1;
    const ticket = ticketRef.current;
    fetcherRef.current().then(
      (next) => {
        if (ticket !== ticketRef.current) return;
        intervalRef.current = baseIntervalMs;
        setData(next);
        setError(null);
      },
      (cause: unknown) => {
        if (ticket !== ticketRef.current) return;
        intervalRef.current = Math.min(intervalRef.current * 2, MAX_INTERVAL_MS);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [baseIntervalMs]);

  // A new fetcher means a different resource: drop whatever the old one loaded
  // so a stale body is never shown under the new id.
  useEffect(() => {
    ticketRef.current += 1;
    intervalRef.current = baseIntervalMs;
    setData(null);
    setError(null);
    load();
  }, [load, baseIntervalMs]);

  const active = shouldPoll(data);
  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        schedule();
        return;
      }
      load();
      schedule();
    };
    const schedule = () => {
      timer = window.setTimeout(tick, intervalRef.current);
    };

    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    schedule();

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, load]);

  const mutate = useCallback((updater: (current: T | null) => T | null) => {
    setData(updater);
  }, []);

  return { data, error, reload: load, mutate };
}
