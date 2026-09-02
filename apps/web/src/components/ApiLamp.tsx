'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useInterval } from '../lib/use-interval';

export function ApiLamp() {
  const [ok, setOk] = useState<boolean | null>(null);
  const ping = useCallback(() => {
    api
      .health()
      .then(() => setOk(true))
      .catch(() => setOk(false));
  }, []);

  useEffect(ping, [ping]);
  useInterval(ping, true, 4000);

  const label = ok === null ? 'API…' : ok ? 'API online' : 'API offline';
  return (
    <span className="lamp" data-state={ok === true ? 'live' : ok === false ? 'down' : 'wait'}>
      <span className="lamp-dot" />
      {label}
    </span>
  );
}
