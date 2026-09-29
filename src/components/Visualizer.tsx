import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '../core/audioEngine'
import type { VizMode } from '../core/draw'
import { VisualizerController } from '../core/visualizerController'
import { Activity, BarChart3 } from 'lucide-react'

interface VisualizerProps {
  engine: AudioEngine
}

export default function Visualizer({ engine }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<VizMode>('waveform')
  const modeRef = useRef<VizMode>(mode)
  const [fadeState, setFadeState] = useState<'in' | 'out'>('in')
  const [pendingMode, setPendingMode] = useState<VizMode | null>(null)
  const [hasFile, setHasFile] = useState(() => Boolean(engine.getSnapshot().fileName))

  // The controller owns the render loop, canvas sizing and per-frame draw.
  // It is created once and never rebuilt; mode is read through a ref so
  // switching modes never restarts the loop.
  const controllerRef = useRef<VisualizerController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = new VisualizerController(engine, () => modeRef.current)
  }

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(
    () => engine.subscribe(() => setHasFile(Boolean(engine.getSnapshot().fileName))),
    [engine],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const controller = controllerRef.current!
    controller.attach(canvas)
    return () => controller.detach()
  }, [])

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
