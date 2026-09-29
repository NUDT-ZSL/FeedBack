import { useCallback, useRef } from 'react';
import type { SwipeDirection } from '@/utils/types';

interface UseSwipeOptions {
  threshold?: number;
  onSwipe?: (direction: SwipeDirection) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

interface SwipeState {
  startX: number;
  startY: number;
  currentX: number;
  active: boolean;
}

export function useSwipe(options: UseSwipeOptions = {}) {
  const { threshold = 60, onSwipe, onSwipeLeft, onSwipeRight } = options;
  const stateRef = useRef<SwipeState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    active: false,
  });
  const elementRef = useRef<HTMLElement | null>(null);

  const onStart = useCallback((clientX: number, clientY: number) => {
    stateRef.current = {
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      active: true,
    };
  }, []);

  const onMove = useCallback((clientX: number) => {
    if (!stateRef.current.active) return 0;
    stateRef.current.currentX = clientX;
    return clientX - stateRef.current.startX;
  }, []);

  const onEnd = useCallback(() => {
    if (!stateRef.current.active) return;
    const diff = stateRef.current.currentX - stateRef.current.startX;
    stateRef.current.active = false;

    let direction: SwipeDirection = null;
    if (diff > threshold) direction = 'right';
    else if (diff < -threshold) direction = 'left';

    if (direction) {
      onSwipe?.(direction);
      if (direction === 'left') onSwipeLeft?.();
      if (direction === 'right') onSwipeRight?.();
    }
  }, [threshold, onSwipe, onSwipeLeft, onSwipeRight]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      onStart(e.clientX, e.clientY);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [onStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>): number => {
      const el = elementRef.current || (e.currentTarget as HTMLElement);
      if (!stateRef.current.active) return 0;
      const deltaX = onMove(e.clientX);
      el.style.transform = `translateX(${deltaX}px)`;
      return deltaX;
    },
    [onMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const el = elementRef.current || (e.currentTarget as HTMLElement);
      el.style.transform = '';
      onEnd();
    },
    [onEnd],
  );

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    elementRef,
  };
}
