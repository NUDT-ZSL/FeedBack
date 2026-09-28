import { useEffect, useRef, useCallback } from 'react';

export function useInfiniteScroll(
  onLoadMore: () => Promise<void> | void,
  hasMore: boolean,
  threshold = 200
) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    try {
      await onLoadMore();
    } finally {
      setTimeout(() => {
        loadingRef.current = false;
      }, 300);
    }
  }, [onLoadMore, hasMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingRef.current) {
          loadMore();
        }
      },
      { rootMargin: `${threshold}px` }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore, threshold]);

  return sentinelRef;
}
