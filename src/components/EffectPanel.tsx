import { useState } from 'react'
import {
  Volume2,
  VolumeX,
  GitBranch,
  Gauge,
  FlipHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type EffectType = 'fadeIn' | 'fadeOut' | 'echo' | 'speed' | 'reverse'

export interface EffectParams {
  fadeIn?: { start: number; end: number; duration: number }
  fadeOut?: { start: number; end: number; duration: number }
  echo?: { delay: number; decay: number }
  speed?: { rate: number }
  reverse?: Record<string, never>
}

export interface EffectPanelProps {
  inPoint: number
  outPoint: number
  onApplyEffect: (type: EffectType, params: EffectParams, inPoint: number, outPoint: number) => void
}

interface EffectButton {
  type: EffectType
  label: string
  color: string
  hoverColor: string
  icon: React.ReactNode
  hasSlider?: boolean
}

export default function EffectPanel({ inPoint, outPoint, onApplyEffect }: EffectPanelProps) {
  const [speedRate, setSpeedRate] = useState(1.0)
  const [pressedButton, setPressedButton] = useState<EffectType | null>(null)

  const handleButtonClick = (type: EffectType) => {
    setPressedButton(type)
    setTimeout(() => setPressedButton(null), 150)

    let params: EffectParams = {}

    switch (type) {
      case 'fadeIn':
        params = { fadeIn: { start: 0, end: 1, duration: 2 } }
        break
      case 'fadeOut':
        params = { fadeOut: { start: 1, end: 0, duration: 2 } }
        break
      case 'echo':
        params = { echo: { delay: 0.3, decay: 0.5 } }
        break
      case 'speed':
        params = { speed: { rate: speedRate } }
        break
      case 'reverse':
        params = { reverse: {} }
        break
    }

    onApplyEffect(type, params, inPoint, outPoint)
  }

  const effectButtons: EffectButton[] = [
    {
      type: 'fadeIn',
      label: '淡入',
      color: '#22c55e',
      hoverColor: '#16a34a',
      icon: <Volume2 className="h-5 w-5" />,
    },
    {
      type: 'fadeOut',
      label: '淡出',
      color: '#ef4444',
      hoverColor: '#dc2626',
      icon: <VolumeX className="h-5 w-5" />,
    },
    {
      type: 'echo',
      label: '回声',
      color: '#a855f7',
      hoverColor: '#9333ea',
      icon: <GitBranch className="h-5 w-5" />,
    },
    {
      type: 'speed',
      label: '变速',
      color: '#f97316',
      hoverColor: '#ea580c',
      icon: <Gauge className="h-5 w-5" />,
      hasSlider: true,
    },
    {
      type: 'reverse',
      label: '翻转',
      color: '#3b82f6',
      hoverColor: '#2563eb',
      icon: <FlipHorizontal className="h-5 w-5" />,
    },
  ]

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-gray-900 p-4">
      <h3 className="text-sm font-semibold text-gray-200">音效效果</h3>
      <div className="flex flex-wrap gap-3">
        {effectButtons.map((button) => (
          <div key={button.type} className="flex flex-col gap-2">
            <button
              onClick={() => handleButtonClick(button.type)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-white font-medium',
                'transition-all duration-150 ease-out',
                'hover:-translate-y-0.5 hover:shadow-lg',
                'active:scale-95',
                pressedButton === button.type ? 'scale-95' : ''
              )}
              style={{
                backgroundColor: button.color,
                transition: 'transform 0.15s ease-out, background-color 0.15s ease-out',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = button.hoverColor
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = button.color
              }}
            >
              {button.icon}
              <span>{button.label}</span>
            </button>
            {button.hasSlider && (
              <div className="flex items-center gap-2 px-1">
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={speedRate}
                  onChange={(e) => setSpeedRate(parseFloat(e.target.value))}
                  className="h-1.5 w-24 cursor-pointer appearance-none rounded-lg bg-gray-700"
                  style={{
                    accentColor: button.color,
                  }}
                />
                <span className="text-xs font-medium text-gray-300 w-10">
                  {speedRate.toFixed(1)}x
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-500">
        选区: {inPoint.toFixed(2)}s - {outPoint.toFixed(2)}s
      </div>
    </div>
  )
}
