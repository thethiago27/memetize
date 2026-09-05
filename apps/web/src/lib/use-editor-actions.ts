'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * Busy tracking for the editor's buttons (editor-transport spec). Each
 * action runs under a key; a button disables on its own key only. Actions
 * that rewrite the timeline share one lock, together with running jobs, so
 * two of them never race.
 */
export interface EditorActions {
  busy: ReadonlySet<string>;
  isBusy(key: string): boolean;
  /** A timeline-group action or a pipeline job is in flight. */
  timelineLocked: boolean;
  /** Resolves `true` when the action succeeded. Reloads the project unless told not to. */
  run(
    key: string,
    action: () => Promise<unknown>,
    success?: string,
    options?: { reload?: boolean },
  ): Promise<boolean>;
}

const TIMELINE_KEYS = ['generate', 'swap:', 'window:'];

export function isTimelineKey(key: string): boolean {
  return TIMELINE_KEYS.some((prefix) => key === prefix || key.startsWith(prefix));
}

export function useEditorActions({
  reload,
  notify,
  jobsActive,
}: {
  reload: () => void;
  notify: (text: string, tone?: 'ok' | 'bad') => void;
  jobsActive: boolean;
}): EditorActions {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const run = useCallback(
    async (
      key: string,
      action: () => Promise<unknown>,
      success?: string,
      options?: { reload?: boolean },
    ) => {
      setBusy((current) => new Set(current).add(key));
      try {
        await action();
        if (success) notify(success);
        if (options?.reload !== false) reload();
        return true;
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), 'bad');
        return false;
      } finally {
        setBusy((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [notify, reload],
  );

  return useMemo(
    () => ({
      busy,
      isBusy: (key: string) => busy.has(key),
      timelineLocked: jobsActive || [...busy].some(isTimelineKey),
      run,
    }),
    [busy, jobsActive, run],
  );
}
