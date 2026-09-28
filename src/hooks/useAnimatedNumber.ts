import { useEffect, useRef, useState } from 'react';

export function useAnimatedNumber(
  target: number,
  duration: number = 500,
  easing: (t: number) => number = easeOutCubic
): number {
  const [value, setValue] = useState(target);
  const previousTarget = useRef(target);
  const startValue = useRef(target);
  const startTime = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);

  useEffect(() => {
    if (target === previousTarget.current) {
      return;
    }

    startValue.current = value;
    previousTarget.current = target;
    startTime.current = null;

    const animate = (timestamp: number) => {
      if (startTime.current === null) {
        startTime.current = timestamp;
      }

      const elapsed = timestamp - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easing(progress);
      const currentValue = startValue.current + (target - startValue.current) * easedProgress;

      setValue(currentValue);

      if (progress < 1) {
        animationFrame.current = requestAnimationFrame(animate);
      }
    };

    animationFrame.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrame.current !== null) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [target, duration, easing]);

  return value;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
