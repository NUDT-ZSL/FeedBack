import { RefObject, useRef, useCallback } from 'react';
import type { DragState } from '../types';

export function useDragControls(elementRef: RefObject<HTMLElement | null>) {
  const dragStateRef = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    startTime: 0,
    positions: [],
  });

  const shakeAnimationRef = useRef<number | null>(null);

  const triggerShake = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;

    let count = 0;
    const maxCount = 6;
    const originalTransform = element.style.transform;

    const animate = () => {
      if (count >= maxCount) {
        element.style.transform = originalTransform;
        shakeAnimationRef.current = null;
        return;
      }

      const offset = count % 2 === 0 ? '2px' : '-2px';
      element.style.transform = `translate(${offset}, ${offset})`;
      count++;
      shakeAnimationRef.current = window.setTimeout(animate, 50);
    };

    animate();
  }, [elementRef]);

  const onDragStart = useCallback((e: PointerEvent) => {
    e.preventDefault();
    const state = dragStateRef.current;
    state.isDragging = true;
    state.startX = e.clientX;
    state.startY = e.clientY;
    state.currentX = e.clientX;
    state.currentY = e.clientY;
    state.startTime = performance.now();
    state.positions = [{ x: e.clientX, y: e.clientY, t: state.startTime }];

    triggerShake();

    const element = elementRef.current;
    if (element) {
      element.setPointerCapture(e.pointerId);
    }
  }, [elementRef, triggerShake]);

  const onDragMove = useCallback((e: PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.isDragging) return;

    state.currentX = e.clientX;
    state.currentY = e.clientY;
    state.positions.push({
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
    });
  }, []);

  const onDragEnd = useCallback((e: PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.isDragging) return;

    state.isDragging = false;

    const element = elementRef.current;
    if (element) {
      element.releasePointerCapture(e.pointerId);
    }

    if (shakeAnimationRef.current !== null) {
      clearTimeout(shakeAnimationRef.current);
      shakeAnimationRef.current = null;
    }
  }, [elementRef]);

  const getDragState = useCallback((): DragState => {
    return { ...dragStateRef.current };
  }, []);

  const getDragVelocity = useCallback((): number => {
    const positions = dragStateRef.current.positions;
    if (positions.length < 2) return 0;

    const recent = positions.slice(-5);
    if (recent.length < 2) return 0;

    const first = recent[0];
    const last = recent[recent.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const dt = last.t - first.t;

    if (dt === 0) return 0;

    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance / dt;
  }, []);

  const getPositions = useCallback((): { x: number; y: number; t: number }[] => {
    return [...dragStateRef.current.positions];
  }, []);

  const resetDrag = useCallback((): void => {
    dragStateRef.current = {
      isDragging: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      startTime: 0,
      positions: [],
    };

    if (shakeAnimationRef.current !== null) {
      clearTimeout(shakeAnimationRef.current);
      shakeAnimationRef.current = null;
    }
  }, []);

  return {
    onDragStart,
    onDragMove,
    onDragEnd,
    getDragState,
    getDragVelocity,
    getPositions,
    resetDrag,
  };
}
