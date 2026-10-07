import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface SliderInputProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  onChange: (value: number) => void
}

export default function SliderInput({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: SliderInputProps) {
  const [isAnimating, setIsAnimating] = useState(false)
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    if (value !== displayValue) {
      setIsAnimating(true)
      setDisplayValue(value)
      const timer = setTimeout(() => setIsAnimating(false), 300)
      return () => clearTimeout(timer)
    }
  }, [value, displayValue])

  const percentage = ((value - min) / (max - min)) * 100

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Number(e.target.value)
    onChange(newValue)
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <div
          className={cn(
            'inline-flex items-baseline gap-1 font-semibold transition-transform duration-300',
            isAnimating && 'animate-pulse-bounce'
          )}
          style={{
            color: 'var(--slider-value-color, #3b82f6)',
          }}
        >
          <span className="text-2xl tabular-nums">{displayValue}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{unit}</span>
        </div>
      </div>

      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          className="slider-input w-full h-2 rounded-full appearance-none cursor-pointer bg-transparent"
          style={{
            '--slider-track-color': 'var(--slider-track-color, #e5e7eb)',
            '--slider-fill-color': 'var(--slider-fill-color, #3b82f6)',
            '--slider-thumb-color': 'var(--slider-thumb-color, #3b82f6)',
            '--slider-thumb-size': 'var(--slider-thumb-size, 20px)',
            background: `linear-gradient(to right, var(--slider-fill-color) 0%, var(--slider-fill-color) ${percentage}%, var(--slider-track-color) ${percentage}%, var(--slider-track-color) 100%)`,
          } as React.CSSProperties}
        />

        <div className="absolute -bottom-5 left-0 right-0 flex justify-between px-1">
          {Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => {
            const tickValue = min + i * step
            const isActive = tickValue <= value
            return (
              <div
                key={i}
                className={cn(
                  'w-1 h-1 rounded-full transition-all duration-200',
                  isActive
                    ? 'bg-blue-500 dark:bg-blue-400'
                    : 'bg-gray-300 dark:bg-gray-600',
                  isAnimating && isActive && 'animate-tick-bounce'
                )}
                style={{
                  transitionDelay: `${i * 20}ms`,
                }}
              />
            )
          })}
        </div>
      </div>

      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 pt-4">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>

      <style>{`
        .slider-input::-webkit-slider-thumb {
          appearance: none;
          width: var(--slider-thumb-size);
          height: var(--slider-thumb-size);
          border-radius: 50%;
          background: var(--slider-thumb-color);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.4);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          border: 2px solid white;
        }

        .slider-input::-webkit-slider-thumb:hover {
          transform: scale(1.1);
          box-shadow: 0 3px 10px rgba(59, 130, 246, 0.5);
        }

        .slider-input::-webkit-slider-thumb:active {
          transform: scale(0.95);
        }

        .slider-input::-moz-range-thumb {
          width: var(--slider-thumb-size);
          height: var(--slider-thumb-size);
          border-radius: 50%;
          background: var(--slider-thumb-color);
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.4);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .slider-input::-moz-range-thumb:hover {
          transform: scale(1.1);
          box-shadow: 0 3px 10px rgba(59, 130, 246, 0.5);
        }

        .slider-input::-moz-range-track {
          background: transparent;
        }

        @keyframes pulse-bounce {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.15);
          }
        }

        @keyframes tick-bounce {
          0%, 100% {
            transform: scale(1) translateY(0);
          }
          50% {
            transform: scale(1.5) translateY(-2px);
          }
        }

        .animate-pulse-bounce {
          animation: pulse-bounce 0.3s ease-in-out;
        }

        .animate-tick-bounce {
          animation: tick-bounce 0.3s ease-in-out;
        }
      `}</style>
    </div>
  )
}
