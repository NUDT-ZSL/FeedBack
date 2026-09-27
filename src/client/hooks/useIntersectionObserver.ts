import { useEffect, useRef } from 'react';

interface IntersectionObserverOptions {
  root?: Element | null;
  rootMargin?: string;
  threshold?: number | number[];
}

export function useIntersectionObserver(
  callback: (entry: IntersectionObserverEntry) => void,
  options: IntersectionObserverOptions = {}
) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          callback(entry);
        }
      },
      options
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [callback, options]);

  return ref;
}
