import { useRef, useEffect } from 'react'

interface AudioVisualizerProps {
  isPlaying: boolean
  barCount?: number
  height?: number
}

export default function AudioVisualizer({
  isPlaying,
  barCount = 256,
  height = 200,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>()
  const barHeightsRef = useRef<number[]>(new Array(barCount).fill(0))
  const targetHeightsRef = useRef<number[]>(new Array(barCount).fill(0))
  const timeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = height * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const barWidth = width / barCount - 1

      ctx.clearRect(0, 0, width, height)

      for (let i = 0; i < barCount; i++) {
        if (isPlaying) {
          const baseFreq = Math.sin(timeRef.current * 0.05 + i * 0.08) * 0.3
          const midFreq = Math.sin(timeRef.current * 0.08 + i * 0.05) * 0.4
          const highFreq = Math.sin(timeRef.current * 0.12 + i * 0.1) * 0.2
          const noise = Math.random() * 0.15

          let target = (Math.abs(baseFreq) + Math.abs(midFreq) + Math.abs(highFreq) + noise) * (height * 0.7)
          target = Math.min(target, height * 0.9)

          const centerFactor = 1 - Math.abs(i - barCount / 2) / (barCount / 2)
          target = target * (0.3 + centerFactor * 0.7)

          targetHeightsRef.current[i] = target
        } else {
          targetHeightsRef.current[i] = 5
        }

        barHeightsRef.current[i] += (targetHeightsRef.current[i] - barHeightsRef.current[i]) * 0.1

        const barHeight = Math.max(3, barHeightsRef.current[i])
        const x = i * (barWidth + 1)
        const y = (height - barHeight) / 2

        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight)
        const colorProgress = Math.abs(i - barCount / 2) / (barCount / 2)

        if (colorProgress < 0.5) {
          const t = colorProgress * 2
          gradient.addColorStop(0, `rgb(${67 + t * 50}, ${97 + t * 20}, ${238 - t * 100})`)
          gradient.addColorStop(0.5, `rgb(${114 - t * 30}, ${9 + t * 40}, ${183 + t * 20})`)
          gradient.addColorStop(1, `rgb(${233 - t * 100}, ${69 + t * 30}, ${96 + t * 50})`)
        } else {
          const t = (colorProgress - 0.5) * 2
          gradient.addColorStop(0, `rgb(${117 + t * 50}, ${29 + t * 30}, ${193 - t * 30})`)
          gradient.addColorStop(0.5, `rgb(${233 - t * 50}, ${69 + t * 20}, ${96 + t * 30})`)
          gradient.addColorStop(1, `rgb(${183 + t * 30}, ${39 + t * 20}, ${166 - t * 50})`)
        }

        ctx.fillStyle = gradient
        ctx.beginPath()
        const radius = Math.min(barWidth / 2, 2)
        ctx.roundRect(x, y, barWidth, barHeight, radius)
        ctx.fill()
      }

      if (isPlaying) {
        timeRef.current += 1
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
  }, [isPlaying, barCount, height])

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height: `${height}px` }}
    />
  )
}
