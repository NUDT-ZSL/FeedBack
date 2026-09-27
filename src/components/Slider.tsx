import { useId } from 'react';
import { cn } from '@/lib/utils';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  color?: string;
}

export default function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  color = '#6366f1',
}: SliderProps) {
  const uniqueId = useId();
  const percentage = ((value - min) / (max - min)) * 100;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(Math.max(min, value - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(Math.min(max, value + step));
    }
  };

  return (
    <div className="w-full">
      <style>
        {`
          #slider-${uniqueId}::-webkit-slider-thumb {
            background-color: ${color};
          }
          #slider-${uniqueId}::-moz-range-thumb {
            background-color: ${color};
          }
          #slider-${uniqueId}:focus::-webkit-slider-thumb {
            --tw-ring-color: ${color};
            box-shadow: 0 0 0 2px white, 0 0 0 4px ${color};
          }
          #slider-${uniqueId}:focus::-moz-range-thumb {
            box-shadow: 0 0 0 2px white, 0 0 0 4px ${color};
          }
        `}
      </style>
      {label && (
        <label
          className="mb-2 flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          <span>{label}</span>
          <span className="text-gray-500 dark:text-gray-400">{Math.round(value * 10) / 10}</span>
        </label>
      )}
      <div className="relative h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all duration-150"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
        <input
          id={`slider-${uniqueId}`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onKeyDown={handleKeyDown}
          className={cn(
            'absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent',
            '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white',
            '[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform',
            '[&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:focus:outline-none',
            '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full',
            '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md',
            '[&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:transition-transform',
            '[&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:focus:outline-none'
          )}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          role="slider"
        />
      </div>
    </div>
  );
}
