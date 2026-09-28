import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { cn } from '@/lib/utils'

interface ProficiencySliderProps {
  skillId: string
  value: number
  onChange?: (value: number) => void
  className?: string
}

export default function ProficiencySlider({
  skillId,
  value,
  onChange,
  className,
}: ProficiencySliderProps) {
  const [localValue, setLocalValue] = useState(value)
  const [inputValue, setInputValue] = useState(String(value))
  const [isDragging, setIsDragging] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)
  const updateProficiency = useAppStore((state) => state.updateProficiency)

  useEffect(() => {
    setLocalValue(value)
    setInputValue(String(value))
  }, [value])

  const getGradientColor = (percentage: number) => {
    const ratio = percentage / 100
    const r = Math.round(255 * (1 - ratio))
    const g = Math.round(255 * ratio)
    return `rgb(${r}, ${g}, 0)`
  }

  const handleSliderChange = (newValue: number) => {
    const clampedValue = Math.max(0, Math.min(100, newValue))
    setLocalValue(clampedValue)
    setInputValue(String(clampedValue))
    updateProficiency(skillId, clampedValue)
    onChange?.(clampedValue)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    updateSliderValue(e.clientX)
  }

  const updateSliderValue = (clientX: number) => {
    if (!sliderRef.current) return
    const rect = sliderRef.current.getBoundingClientRect()
    const percentage = ((clientX - rect.left) / rect.width) * 100
    handleSliderChange(Math.round(percentage))
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        updateSliderValue(e.clientX)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)
    const numVal = parseInt(val, 10)
    if (!isNaN(numVal) && numVal >= 0 && numVal <= 100) {
      setLocalValue(numVal)
      updateProficiency(skillId, numVal)
      onChange?.(numVal)
    }
  }

  const handleInputBlur = () => {
    const numVal = parseInt(inputValue, 10)
    if (isNaN(numVal) || numVal < 0 || numVal > 100) {
      setInputValue(String(localValue))
    }
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-600">调整熟练度</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="100"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            className="w-16 px-2 py-1 text-right text-sm font-semibold border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            style={{ color: getGradientColor(localValue) }}
          />
          <span className="text-sm font-medium text-gray-400">%</span>
        </div>
      </div>

      <div
        ref={sliderRef}
        className="relative h-3 bg-gray-100 rounded-full cursor-pointer select-none"
        onMouseDown={handleMouseDown}
      >
        <div
          className="absolute h-full rounded-full transition-all duration-150"
          style={{
            width: `${localValue}%`,
            background: `linear-gradient(to right, #ef4444, #22c55e)`,
          }}
        />
        <div
          className={cn(
            'absolute top-1/2 -translate-y-1/2 w-6 h-6 bg-white border-2 rounded-full shadow-md cursor-grab transition-all duration-150',
            isDragging && 'cursor-grabbing scale-110 shadow-lg'
          )}
          style={{
            left: `calc(${localValue}% - 12px)`,
            borderColor: getGradientColor(localValue),
          }}
        />
      </div>

      <div className="flex justify-between text-xs text-gray-400">
        <span>初学者</span>
        <span>精通</span>
      </div>
    </div>
  )
}
