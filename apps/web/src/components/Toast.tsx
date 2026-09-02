'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

type Tone = 'ok' | 'bad';

interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

interface ToastApi {
  notify: (text: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi>({ notify: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const notify = useCallback((text: string, tone: Tone = 'ok') => {
    seq.current += 1;
    const id = seq.current;
    setToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone}>
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
