'use client';

import { useCallback } from 'react';
import { api } from '../lib/api';
import { usePolledResource } from '../lib/use-polled-resource';

/**
 * Health lamp. Polls through `usePolledResource` like every other view, so it
 * pauses in a hidden tab and backs off while the API is down instead of asking
 * every 4 seconds forever.
 */
export function ApiLamp() {
  const { data, error } = usePolledResource(
    useCallback(() => api.health(), []),
    // Health is never "done": keep polling whatever the answer was.
    useCallback(() => true, []),
    4000,
  );

  const ok = error !== null ? false : data === null ? null : true;
  const label = ok === null ? 'API…' : ok ? 'API online' : 'API offline';
  return (
    <span className="lamp" data-state={ok === true ? 'live' : ok === false ? 'down' : 'wait'}>
      <span className="lamp-dot" />
      {label}
    </span>
  );
}
