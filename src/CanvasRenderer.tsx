import React, { useRef, useEffect, useState, useCallback } from 'react'
import { toPng } from 'html-to-image'
import { ParagraphAnalysis, EMOTION_CONFIGS } from './EmotionAnalyzer'

interface CanvasRendererProps {
  analysis: ParagraphAnalysis[]
  currentParagraphIndex: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  opacity: number
  shape: 'circle' | 'line' | 'triangle'
  emotion: string
  phase: number
  baseY?: number
}

interface Tooltip {
  x: number
  y: number
  keyword: string
  confidence: number
}

const CanvasRenderer: React.FC<CanvasRendererProps> = ({ analysis, currentParagraphIndex }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number>(0)
  const particlesRef = useRef<Particle[]>([])
  const transitionRef = useRef({ fromOpacity: 1, toOpacity: 1, progress: 1 })
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [showFlash, setShowFlash] = useState(false)
  const timeRef = useRef(0)

  const getDominantEmotion = useCallback(() => {
    if (analysis.length === 0) return 'peace'
    const dominant = analysis[currentParagraphIndex]?.dominant
    if (!dominant) return 'peace'
    if (dominant.color === EMOTION_CONFIGS.joy.color) return 'joy'
    if (dominant.color === EMOTION_CONFIGS.sadness.color) return 'sadness'
    if (dominant.color === EMOTION_CONFIGS.anger.color) return 'anger'
    return 'peace'
  }, [analysis, currentParagraphIndex])

  const generateParticles = useCallback((emotion: string, width: number, height: number): Particle[] => {
    const particles: Particle[] = []
    const config = EMOTION_CONFIGS[emotion]
    const count = 80

    if (emotion === 'joy') {
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.3 + Math.random() * 0.5),
          size: 6 + Math.random() * 6,
          color: config.gradient[Math.floor(Math.random() * config.gradient.length)],
          opacity: 0.6 + Math.random() * 0.4,
          shape: 'circle',
          emotion: 'joy',
          phase: Math.random() * Math.PI * 2
        })
      }
    } else if (emotion === 'sadness') {
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: 0,
          vy: 0.5 + Math.random() * 0.8,
          size: 2,
          color: config.gradient[Math.floor(Math.random() * config.gradient.length)],
          opacity: 0.5,
          shape: 'line',
          emotion: 'sadness',
          phase: Math.random() * Math.PI * 2,
          baseY: Math.random() * height
        })
      }
    } else if (emotion === 'anger') {
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          size: 8 + Math.random() * 8,
          color: config.gradient[Math.floor(Math.random() * config.gradient.length)],
          opacity: 0.8,
          shape: 'triangle',
          emotion: 'anger',
          phase: Math.random() * Math.PI * 2
        })
      }
    } else {
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: Math.sin(Math.random() * Math.PI * 2) * 0.2,
          size: 4 + Math.random() * 6,
          color: config.gradient[Math.floor(Math.random() * config.gradient.length)],
          opacity: 0.5 + Math.random() * 0.3,
          shape: 'circle',
          emotion: 'peace',
          phase: Math.random() * Math.PI * 2
        })
      }
    }
    return particles
  }, [])

  const drawGradientBackground = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, emotion: string) => {
    const config = EMOTION_CONFIGS[emotion]
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.5)
    gradient.addColorStop(0, config.gradient[0] + '33')
    gradient.addColorStop(0.5, config.gradient[1] + '1a')
    gradient.addColorStop(1, '#000000')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }, [])

  const drawParticle = useCallback((ctx: CanvasRenderingContext2D, particle: Particle, time: number) => {
    ctx.save()
    ctx.globalAlpha = particle.opacity

    if (particle.shape === 'circle') {
      const wobble = Math.sin(time * 0.002 + particle.phase) * 2
      ctx.beginPath()
      const gradient = ctx.createRadialGradient(
        particle.x + wobble, particle.y, 0,
        particle.x + wobble, particle.y, particle.size
      )
      gradient.addColorStop(0, particle.color)
      gradient.addColorStop(1, particle.color + '00')
      ctx.fillStyle = gradient
      ctx.arc(particle.x + wobble, particle.y, particle.size, 0, Math.PI * 2)
      ctx.fill()
    } else if (particle.shape === 'line') {
      const lineLength = 30 + Math.sin(time * 0.001 + particle.phase) * 10
      ctx.strokeStyle = particle.color
      ctx.lineWidth = particle.size
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(particle.x, particle.y)
      ctx.lineTo(particle.x + 2, particle.y + lineLength)
      ctx.stroke()
    } else if (particle.shape === 'triangle') {
      const flicker = Math.sin(time * 0.004 + particle.phase) > 0 ? 1 : 0.3
      ctx.globalAlpha = particle.opacity * flicker
      ctx.fillStyle = particle.color
      ctx.translate(particle.x, particle.y)
      ctx.rotate(time * 0.003 + particle.phase)
      ctx.beginPath()
      ctx.moveTo(0, -particle.size)
      ctx.lineTo(-particle.size * 0.866, particle.size * 0.5)
      ctx.lineTo(particle.size * 0.866, particle.size * 0.5)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }, [])

  const drawWaveform = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, emotion: string, time: number) => {
    if (emotion === 'anger') {
      ctx.save()
      ctx.strokeStyle = '#ee5253'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.6
      for (let line = 0; line < 5; line++) {
        ctx.beginPath()
        const baseY = height * 0.3 + line * 40
        for (let x = 0; x <= width; x += 5) {
          const y = baseY + Math.sin(x * 0.02 + time * 0.005 + line) * 20 * Math.abs(Math.sin(x * 0.01))
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = EMOTION_CONFIGS.anger.gradient[line % 3]
        ctx.stroke()
      }
      ctx.restore()
    } else if (emotion === 'peace') {
      ctx.save()
      ctx.strokeStyle = '#1dd1a1'
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.4
      for (let line = 0; line < 4; line++) {
        ctx.beginPath()
        const baseY = height * 0.4 + line * 50
        for (let x = 0; x <= width; x += 3) {
          const y = baseY + Math.sin(x * 0.015 + time * 0.001 + line * 0.5) * 15
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = EMOTION_CONFIGS.peace.gradient[line % 3]
        ctx.stroke()
      }
      ctx.restore()
    } else if (emotion === 'joy') {
      ctx.save()
      ctx.globalAlpha = 0.3
      for (let line = 0; line < 3; line++) {
        ctx.beginPath()
        const baseY = height * 0.7 - line * 40
        for (let x = 0; x <= width; x += 2) {
          const y = baseY - Math.abs(Math.sin(x * 0.02 + time * 0.002 + line)) * 50
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = EMOTION_CONFIGS.joy.gradient[line % 3]
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.restore()
    } else if (emotion === 'sadness') {
      ctx.save()
      ctx.globalAlpha = 0.25
      for (let line = 0; line < 3; line++) {
        ctx.beginPath()
        const baseY = height * 0.3 + line * 60
        for (let x = 0; x <= width; x += 3) {
          const y = baseY + Math.sin(x * 0.01 + time * 0.0008 + line) * 20
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = EMOTION_CONFIGS.sadness.gradient[line % 3]
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.restore()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
    }

    resize()
    window.addEventListener('resize', resize)

    const currentEmotion = getDominantEmotion()
    particlesRef.current = generateParticles(currentEmotion, canvas.width, canvas.height)

    const animate = () => {
      timeRef.current += 16
      const { width, height } = canvas
      const emotion = getDominantEmotion()

      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)

      drawGradientBackground(ctx, width, height, emotion)
      drawWaveform(ctx, width, height, emotion, timeRef.current)

      particlesRef.current.forEach(p => {
        if (p.emotion === 'joy') {
          p.y += p.vy
          p.x += p.vx + Math.sin(timeRef.current * 0.002 + p.phase) * 0.5
          if (p.y < -20) {
            p.y = height + 10
            p.x = Math.random() * width
          }
        } else if (p.emotion === 'sadness') {
          p.y += p.vy
          if (p.y > height + 40) {
            p.y = -40
            p.x = Math.random() * width
          }
        } else if (p.emotion === 'anger') {
          p.x += p.vx
          p.y += p.vy
          if (p.x < -20) p.x = width + 20
          if (p.x > width + 20) p.x = -20
          if (p.y < -20) p.y = height + 20
          if (p.y > height + 20) p.y = -20
        } else {
          p.x += p.vx
          p.y += p.vy
          if (p.x < -20) p.x = width + 20
          if (p.x > width + 20) p.x = -20
          if (p.y < -20) p.y = height + 20
          if (p.y > height + 20) p.y = -20
        }
        drawParticle(ctx, p, timeRef.current)
      })

      animationRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationRef.current)
    }
  }, [getDominantEmotion, generateParticles, drawGradientBackground, drawParticle, drawWaveform])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const emotion = getDominantEmotion()
    particlesRef.current = generateParticles(emotion, canvas.width, canvas.height)
  }, [currentParagraphIndex, getDominantEmotion, generateParticles])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    let found: Particle | null = null
    for (const p of particlesRef.current) {
      const dx = mx - p.x
      const dy = my - p.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < Math.max(p.size, 15)) {
        found = p
        break
      }
    }

    if (found) {
      const currentAnalysis = analysis[currentParagraphIndex]
      const emotionConf = currentAnalysis?.emotions.find(e => {
        if (found!.emotion === 'joy') return e.color === EMOTION_CONFIGS.joy.color
        if (found!.emotion === 'sadness') return e.color === EMOTION_CONFIGS.sadness.color
        if (found!.emotion === 'anger') return e.color === EMOTION_CONFIGS.anger.color
        return e.color === EMOTION_CONFIGS.peace.color
      })
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        keyword: emotionConf?.keyword || EMOTION_CONFIGS[found.emotion].name,
        confidence: emotionConf?.confidence || 0.5
      })
    } else {
      setTooltip(null)
    }
  }, [analysis, currentParagraphIndex])

  const handleExport = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    setShowFlash(true)

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = 1920
    exportCanvas.height = 1080
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) return

    const emotion = getDominantEmotion()
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 1920, 1080)

    drawGradientBackground(ctx, 1920, 1080, emotion)
    drawWaveform(ctx, 1920, 1080, emotion, timeRef.current)

    const exportParticles = generateParticles(emotion, 1920, 1080)
    exportParticles.forEach(p => {
      for (let i = 0; i < 50; i++) {
        if (p.emotion === 'joy') {
          p.y += p.vy
          p.x += p.vx
        } else if (p.emotion === 'sadness') {
          p.y += p.vy
        } else {
          p.x += p.vx
          p.y += p.vy
        }
      }
      drawParticle(ctx, p, timeRef.current)
    })

    exportCanvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `emotion-art-${Date.now()}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')

    setTimeout(() => setShowFlash(false), 300)
  }, [getDominantEmotion, drawGradientBackground, drawWaveform, generateParticles, drawParticle])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#000000',
        overflow: 'hidden'
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        style={{ display: 'block', width: '100%', height: '100%', cursor: 'crosshair' }}
      />

      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 15,
            top: tooltip.y + 15,
            background: 'rgba(30, 30, 46, 0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: '8px',
            padding: '10px 14px',
            color: '#ffffff',
            fontSize: '13px',
            pointerEvents: 'none',
            animation: 'tooltipFadeIn 0.2s ease',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            情绪关键词：{tooltip.keyword}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)' }}>
            置信度：{(tooltip.confidence * 100).toFixed(1)}%
          </div>
        </div>
      )}

      <button
        onClick={handleExport}
        style={{
          position: 'absolute',
          right: '24px',
          bottom: '24px',
          padding: '12px 24px',
          background: 'linear-gradient(135deg, #cba6f7 0%, #89b4fa 100%)',
          border: 'none',
          borderRadius: '10px',
          color: '#1e1e2e',
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: '0 4px 15px rgba(203, 166, 247, 0.3)'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 6px 20px rgba(203, 166, 247, 0.4)'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 4px 15px rgba(203, 166, 247, 0.3)'
        }}
      >
        保存为PNG
      </button>

      {showFlash && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255, 255, 255, 0.9)',
            animation: 'flashFade 0.3s ease forwards',
            pointerEvents: 'none'
          }}
        />
      )}

      <style>{`
        @keyframes tooltipFadeIn {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes flashFade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

export default CanvasRenderer
