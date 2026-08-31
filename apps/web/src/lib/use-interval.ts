'use client';

import { useEffect } from 'react';

/** Poll while `active` is true (Studio jobs PENDING/RUNNING). */
export function useInterval(callback: () => void, active: boolean, ms = 1500): void {
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(callback, ms);
    return () => window.clearInterval(id);
  }, [active, callback, ms]);
}
