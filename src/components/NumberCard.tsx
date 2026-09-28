import React, { useState, useEffect, useRef } from 'react';

interface NumberCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}

export const NumberCard: React.FC<NumberCardProps> = ({
  label,
  value,
  prefix = '',
  suffix = '',
  duration = 500,
}) => {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValueRef = useRef(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const startValue = prevValueRef.current;
    const endValue = value;
    const startTime = performance.now();

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeOut;
      setDisplayValue(Math.round(current * 100) / 100);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        prevValueRef.current = endValue;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  const formatValue = (num: number): string => {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万';
    }
    return num.toFixed(num % 1 === 0 ? 0 : 2);
  };

  return (
    <div className="number-card">
      <span className="number-card-label">{label}</span>
      <span className="number-card-value">
        {prefix}
        {formatValue(displayValue)}
        {suffix}
      </span>
    </div>
  );
};
