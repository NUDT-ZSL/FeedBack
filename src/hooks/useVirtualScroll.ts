import { useState, useEffect, useRef, useMemo } from 'react';

interface UseVirtualScrollOptions<T> {
  containerRef: React.RefObject<HTMLElement>;
  items: T[];
  itemHeight: number;
}

interface UseVirtualScrollResult<T> {
  visibleItems: T[];
  startOffset: number;
  totalHeight: number;
}

export function useVirtualScroll<T>({
  containerRef,
  items,
  itemHeight
}: UseVirtualScrollOptions<T>): UseVirtualScrollResult<T> {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const rafRef = useRef<number | null>(null);

  const totalHeight = items.length * itemHeight;

  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight));
    const visibleCount = Math.ceil(containerHeight / itemHeight) + 2;
    const endIndex = Math.min(items.length, startIndex + visibleCount);
    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, items.length, itemHeight]);

  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.startIndex, visibleRange.endIndex);
  }, [items, visibleRange.startIndex, visibleRange.endIndex]);

  const startOffset = visibleRange.startIndex * itemHeight;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      setContainerHeight(container.clientHeight);
    };

    const handleScroll = () => {
      if (rafRef.current !== null) {
        return;
      }

      rafRef.current = requestAnimationFrame(() => {
        setScrollTop(container.scrollTop);
        rafRef.current = null;
      });
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(container);

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateDimensions);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateDimensions);
    };
  }, [containerRef]);

  return {
    visibleItems,
    startOffset,
    totalHeight
  };
}
