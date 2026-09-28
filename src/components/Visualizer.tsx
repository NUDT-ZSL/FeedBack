import { useEffect, useRef, useState } from 'react'
import { AudioAnalyzer } from '../utils/audioAnalyzer'
import { Activity, BarChart3 } from 'lucide-react'

interface VisualizerProps {
  analyzer: AudioAnalyzer | null
  isPlaying: boolean
  isSeeking: boolean
}

type VizMode = 'waveform' | 'spectrum'

export default function Visualizer({ analyzer, isPlaying, isSeeking }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const [mode, setMode] = useState<VizMode>('waveform')
  const [fadeState, setFadeState] = useState<'in' | 'out'>('in')
  const [pendingMode, setPendingMode] = useState<VizMode | null>(null)

  const handleModeChange = (newMode: VizMode) => {
    if (newMode === mode) return
    setPendingMode(newMode)
    setFadeState('out')
    setTimeout(() => {
      setMode(newMode)
      setPendingMode(null)
      setFadeState('in')
    }, 300)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const width = canvas.width
      const height = canvas.height

      ctx.fillStyle = '#0f0f23'
      ctx.fillRect(0, 0, width, height)

      if (analyzer && isPlaying && !isSeeking) {
        if (mode === 'waveform') {
          drawWaveform(ctx, analyzer, width, height)
        } else {
          drawSpectrum(ctx, analyzer, width, height)
        }
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, height / 2)
        ctx.lineTo(width, height / 2)
        ctx.stroke()
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    animationRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animationRef.current)
    }
  }, [analyzer, isPlaying, isSeeking, mode])

  const drawWaveform = (ctx: CanvasRenderingContext2D, analyzer: AudioAnalyzer, width: number, height: number) => {
    const data = analyzer.getTimeDomainData()
    const sliceWidth = width / data.length

    ctx.lineWidth = 2
    ctx.strokeStyle = '#22c55e'
    ctx.beginPath()

    let x = 0
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0
      const y = (v * height) / 2
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
      x += sliceWidth
    }

    ctx.lineTo(width, height / 2)
    ctx.stroke()
  }

  const drawSpectrum = (ctx: CanvasRenderingContext2D, analyzer: AudioAnalyzer, width: number, height: number) => {
    const data = analyzer.getFrequencyData()
    const usableBins = Math.floor(data.length * 0.6)
    const barCount = Math.min(64, usableBins)
    const barWidth = width / barCount
    const gap = Math.max(1, barWidth * 0.15)
    const actualBarWidth = barWidth - gap

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * usableBins)
      const value = data[dataIndex] / 255
      const barHeight = value * height

      const x = i * barWidth + gap / 2
      const y = height - barHeight

      const gradient = ctx.createLinearGradient(0, height, 0, y)
      gradient.addColorStop(0, '#3b82f6')
      gradient.addColorStop(0.5, '#ef4444')
      gradient.addColorStop(1, '#f97316')

      ctx.fillStyle = gradient
      ctx.fillRect(x, y, actualBarWidth, barHeight)
    }
  }

  const hasFile = analyzer !== null

  return (
    <div className="relative w-full">
      <div className="flex justify-end mb-2">
        <div className="inline-flex rounded-lg overflow-hidden bg-[#0f3460]">
          <button
            onClick={() => handleModeChange('waveform')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-all duration-200 hover:bg-white/10 ${
              mode === 'waveform' ? 'bg-white/20 text-white' : 'text-white/70'
            }`}
            style={{ minWidth: '44px', minHeight: '44px' }}
          >
            <Activity size={18} />
            <span className="hidden sm:inline">波形</span>
          </button>
          <button
            onClick={() => handleModeChange('spectrum')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-all duration-200 hover:bg-white/10 ${
              mode === 'spectrum' ? 'bg-white/20 text-white' : 'text-white/70'
            }`}
            style={{ minWidth: '44px', minHeight: '44px' }}
          >
            <BarChart3 size={18} />
            <span className="hidden sm:inline">频谱</span>
          </button>
        </div>
      </div>

      <div
        className="relative rounded-lg overflow-hidden transition-opacity duration-300"
        style={{
          opacity: fadeState === 'in' ? 1 : 0,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          border: '2px solid #60a5fa',
        }}
      >
        <canvas
          ref={canvasRef}
          width={800}
          height={400}
          className="w-full block"
          style={{
            background: '#0f0f23',
            aspectRatio: '2 / 1',
            height: 'auto',
          }}
        />

        {!hasFile && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </div>
            <p className="text-white/60 text-center px-4">请上传一个音频文件来开始</p>
          </div>
        )}
      </div>
    </div>
  )
}
