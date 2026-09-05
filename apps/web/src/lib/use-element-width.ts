'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * Content width of an element, kept current through a `ResizeObserver`.
 * The timeline strip lays clips out in pixels from this number.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
