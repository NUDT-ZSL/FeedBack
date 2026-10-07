import { useState, useCallback, useEffect } from 'react';
import type { Spice, DragState } from '../types';

export function useDragAndDrop() {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    spice: null,
    position: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
  });

  const handleDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent, spice: Spice) => {
      let clientX: number, clientY: number;

      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();

      setDragState({
        isDragging: true,
        spice,
        position: { x: clientX, y: clientY },
        offset: {
          x: clientX - rect.left - rect.width / 2,
          y: clientY - rect.top - rect.height / 2,
        },
      });
    },
    []
  );

  const handleDragMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!dragState.isDragging) return;

      let clientX: number, clientY: number;

      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      setDragState((prev) => ({
        ...prev,
        position: { x: clientX, y: clientY },
      }));
    },
    [dragState.isDragging]
  );

  const handleDragEnd = useCallback(() => {
    setDragState({
      isDragging: false,
      spice: null,
      position: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
    });
  }, []);

  useEffect(() => {
    if (dragState.isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);

      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
  }, [dragState.isDragging, handleDragMove, handleDragEnd]);

  return {
    dragState,
    handleDragStart,
    handleDragEnd,
  };
}
