'use client';

import { type FormEvent, type ReactNode, useEffect, useRef } from 'react';

type DialogProps = {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
} & (
  | { as?: 'div'; onSubmit?: never }
  | { as: 'form'; onSubmit: (event: FormEvent<HTMLFormElement>) => void }
);

/**
 * Centered panel over the 60% black overlay. Escape and a click on the
 * overlay dismiss; the parent no-ops `onClose` while a submit is in flight.
 */
export function Dialog({ labelledBy, onClose, children, as = 'div', onSubmit }: DialogProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = as === 'form' ? formRef.current : boxRef.current;
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [as]);

  const shared = {
    className: 'dialog',
    role: 'dialog' as const,
    'aria-modal': true as const,
    'aria-labelledby': labelledBy,
    tabIndex: -1 as const,
  };

  return (
    <div className="overlay">
      <button
        type="button"
        className="overlay-scrim"
        aria-label="Fechar"
        onClick={() => onCloseRef.current()}
      />
      {as === 'form' ? (
        <form ref={formRef} {...shared} onSubmit={onSubmit}>
          {children}
        </form>
      ) : (
        <div ref={boxRef} {...shared}>
          {children}
        </div>
      )}
    </div>
  );
}
