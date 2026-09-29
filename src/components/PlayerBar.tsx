import { useRef, useEffect, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { usePlayerStore } from '../store/usePlayerStore'

export default function PlayerBar() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>()
  const { currentWork, isPlaying, currentTime, duration, volume, togglePlay, setCurrentTime, setVolume, setCurrentWork } = usePlayerStore()
  const [isMuted, setIsMuted] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = rect.height * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    let time = 0
    const bars = 64

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      const barWidth = width / bars - 2

      ctx.clearRect(0, 0, width, height)

      for (let i = 0; i < bars; i++) {
        const barHeight = isPlaying
          ? Math.abs(Math.sin(time * 0.08 + i * 0.3) * 15 + Math.sin(time * 0.12 + i * 0.5) * 10 + Math.random() * 3)
          : 5

        const x = i * (barWidth + 2)
        const y = (height - barHeight) / 2

        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight)
        gradient.addColorStop(0, '#4361EE')
        gradient.addColorStop(0.5, '#7209B7')
        gradient.addColorStop(1, '#E94560')

        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, 2)
        ctx.fill()
      }

      if (isPlaying) {
        time += 1
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isPlaying])

  useEffect(() => {
    if (isPlaying && currentWork) {
      const interval = setInterval(() => {
        const newTime = usePlayerStore.getState().currentTime + 1
        if (newTime < duration || duration === 0) {
          usePlayerStore.getState().setCurrentTime(duration === 0 ? (newTime % 180) : newTime)
        } else {
          usePlayerStore.getState().setPlaying(false)
        }
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isPlaying, currentWork, duration])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const newTime = percent * (duration || 180)
    setCurrentTime(Math.max(0, Math.min(newTime, duration || 180)))
  }

  const handleClose = () => {
    setCurrentWork(null)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : (currentTime / 180) * 100

  if (!currentWork) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:left-60">
      <div className="bg-black/80 backdrop-blur-xl border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center"
            style={{ background: currentWork.coverGradient }}
          >
            <span className="text-xs font-bold text-white/80">🎵</span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{currentWork.title}</p>
            <p className="text-xs text-white/50 truncate">{currentWork.artistName}</p>
          </div>

          <div className="hidden md:block flex-1 max-w-md">
            <canvas
              ref={canvasRef}
              className="w-full h-8"
              style={{ opacity: 0.8 }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button className="p-2 text-white/60 hover:text-white transition-colors">
              <SkipBack size={18} />
            </button>
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-white text-gray-900 flex items-center justify-center hover:scale-105 transition-transform"
            >
              {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
            </button>
            <button className="p-2 text-white/60 hover:text-white transition-colors">
              <SkipForward size={18} />
            </button>
          </div>

          <div className="hidden md:flex items-center gap-3 w-48">
            <div className="flex-1">
              <div
                className="relative h-1 bg-white/20 rounded-full cursor-pointer"
                onClick={handleProgressClick}
              >
                <div
                  className="absolute h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-white/50">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration || 180)}</span>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-1.5 text-white/60 hover:text-white transition-colors"
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                setVolume(parseFloat(e.target.value))
                setIsMuted(false)
              }}
              className="w-20 h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-pink-500"
            />
          </div>

          <button
            onClick={handleClose}
            className="p-2 text-white/40 hover:text-white transition-colors md:hidden"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
