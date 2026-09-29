import { useCallback } from 'react';

export const useRipple = (color: string = 'rgba(255, 255, 255, 0.5)') => {
  const createRipple = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.backgroundColor = color;

    button.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
    }, 400);
  }, [color]);

  return createRipple;
};
