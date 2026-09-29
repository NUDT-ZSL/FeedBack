import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface VirtualScrollProps<T> {
  items: T[];
  itemHeight: number;
  gap?: number;
  columns?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function VirtualScroll<T>({
  items,
  itemHeight,
  gap = 16,
  columns = 1,
  renderItem,
  className = '',
  style = {},
}: VirtualScrollProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const rowHeight = itemHeight + gap;
  const totalRows = Math.ceil(items.length / columns);
  const totalHeight = totalRows * rowHeight - gap;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setContainerHeight(container.clientHeight);
      
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerHeight(entry.contentRect.height);
        }
      });
      resizeObserver.observe(container);
      
      return () => resizeObserver.disconnect();
    }
  }, []);

  const visibleItems = useMemo(() => {
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 1);
    const visibleRows = Math.ceil(containerHeight / rowHeight) + 2;
    const endRow = Math.min(totalRows, startRow + visibleRows);

    const startIndex = startRow * columns;
    const endIndex = Math.min(items.length, endRow * columns);

    const result: { item: T; index: number; row: number; col: number }[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      const row = Math.floor(i / columns);
      const col = i % columns;
      result.push({ item: items[i], index: i, row, col });
    }
    return result;
  }, [items, scrollTop, containerHeight, rowHeight, columns, totalRows]);

  const offsetY = Math.max(0, (Math.floor(scrollTop / rowHeight) - 1)) * rowHeight;

  return (
    <div
      ref={containerRef}
      className={`virtual-scroll ${className}`}
      style={{
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        ...style,
      }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: offsetY,
            left: 0,
            right: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: `${gap}px`,
          }}
        >
          {visibleItems.map(({ item, index }) => (
            <div key={index} style={{ height: itemHeight }}>
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
