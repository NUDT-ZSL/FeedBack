import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { CutLogic, Point, CutPath, Template, PAPER_SIZE } from '@/utils/cutLogic'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  rotation: number
  rotationSpeed: number
}

interface Sparkle {
  x: number
  y: number
  size: number
  opacity: number
  speed: number
}

interface PaperCanvasProps {
  template: Template | null
  onProgressChange: (progress: number) => void
  onComplete: () => void
  scale: number
  onUndoAvailable: (available: boolean) => void
}

export interface PaperCanvasRef {
  undo: () => void
  reset: () => void
  getCanvasElement: () => HTMLCanvasElement | null
  getCompleted: () => boolean
}

const PaperCanvas = forwardRef<PaperCanvasRef, PaperCanvasProps>(({
  template,
  onProgressChange,
  onComplete,
  scale,
  onUndoAvailable
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cutLogicRef = useRef<CutLogic>(new CutLogic())
  const particlesRef = useRef<Particle[]>([])
  const sparklesRef = useRef<Sparkle[]>([])
  const animationFrameRef = useRef<number>()
  const [isCompleted, setIsCompleted] = useState(false)
  const [templateOpacity, setTemplateOpacity] = useState(0)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const templateImageRef = useRef<HTMLImageElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  useImperativeHandle(ref, () => ({
    undo: () => {
      const success = cutLogicRef.current.undo()
      onUndoAvailable(cutLogicRef.current.canUndo())
      if (success) {
        setIsCompleted(false)
        render()
      }
      return success
    },
    reset: () => {
      cutLogicRef.current.reset()
      particlesRef.current = []
      sparklesRef.current = []
      setIsCompleted(false)
      onUndoAvailable(false)
      onProgressChange(0)
      render()
    },
    getCanvasElement: () => canvasRef.current,
    getCompleted: () => isCompleted
  }))

  const playGuzhengSound = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const ctx = audioContextRef.current
      const notes = [523.25, 587.33, 659.25, 698.46, 783.99, 659.25, 587.33, 523.25]
      const duration = 2 / notes.length
      
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const filter = ctx.createBiquadFilter()
        
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * duration)
        
        filter.type = 'lowpass'
        filter.frequency.setValueAtTime(2000, ctx.currentTime + i * duration)
        
        gain.gain.setValueAtTime(0, ctx.currentTime + i * duration)
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * duration + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * duration + duration * 0.9)
        
        osc.connect(filter)
        filter.connect(gain)
        gain.connect(ctx.destination)
        
        osc.start(ctx.currentTime + i * duration)
        osc.stop(ctx.currentTime + i * duration + duration)
      })
    } catch (e) {
      console.log('Audio not supported')
    }
  }, [])

  const createParticles = useCallback((path: CutPath) => {
    const particles: Particle[] = []
    const count = 20 + Math.floor(Math.random() * 11)
    
    for (let i = 0; i < count; i++) {
      const randomPoint = path.points[Math.floor(Math.random() * path.points.length)]
      particles.push({
        x: randomPoint.x,
        y: randomPoint.y,
        vx: (Math.random() - 0.5) * 4,
        vy: 1 + Math.random() * 3,
        size: 3 + Math.random() * 5,
        opacity: 1,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.3
      })
    }
    
    particlesRef.current = [...particlesRef.current, ...particles]
  }, [])

  const createSparkles = useCallback(() => {
    const sparkles: Sparkle[] = []
    for (let i = 0; i < 50; i++) {
      sparkles.push({
        x: Math.random() * PAPER_SIZE,
        y: Math.random() * PAPER_SIZE,
        size: 2 + Math.random() * 4,
        opacity: Math.random(),
        speed: 0.02 + Math.random() * 0.03
      })
    }
    sparklesRef.current = sparkles
  }, [])

  const createTemplateMask = useCallback((template: Template) => {
    const canvas = document.createElement('canvas')
    canvas.width = PAPER_SIZE
    canvas.height = PAPER_SIZE
    const ctx = canvas.getContext('2d')!
    
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${PAPER_SIZE}" height="${PAPER_SIZE}" viewBox="0 0 400 400">
        ${template.svgPath}
      </svg>
    `
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, PAPER_SIZE, PAPER_SIZE)
      cutLogicRef.current.setTemplateMask(imageData)
    }
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
  }, [])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    
    ctx.clearRect(0, 0, PAPER_SIZE, PAPER_SIZE)
    
    if (isCompleted) {
      const gradient = ctx.createLinearGradient(0, 0, PAPER_SIZE, PAPER_SIZE)
      gradient.addColorStop(0, '#f9e79f')
      gradient.addColorStop(0.3, '#f1c40f')
      gradient.addColorStop(0.5, '#f9e79f')
      gradient.addColorStop(0.7, '#f1c40f')
      gradient.addColorStop(1, '#d4ac0d')
      ctx.fillStyle = gradient
      
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(PAPER_SIZE, 0)
      ctx.lineTo(PAPER_SIZE, PAPER_SIZE)
      ctx.lineTo(0, PAPER_SIZE)
      ctx.closePath()
      
      const cutPaths = cutLogicRef.current.getCutPaths()
      for (const path of cutPaths) {
        if (path.points.length < 2) continue
        ctx.moveTo(path.points[0].x, path.points[0].y)
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y)
        }
      }
      ctx.fill('evenodd')
      
      ctx.globalCompositeOperation = 'lighter'
      for (const sparkle of sparklesRef.current) {
        const glow = ctx.createRadialGradient(sparkle.x, sparkle.y, 0, sparkle.x, sparkle.y, sparkle.size * 2)
        glow.addColorStop(0, `rgba(255, 255, 255, ${sparkle.opacity})`)
        glow.addColorStop(0.5, `rgba(249, 231, 159, ${sparkle.opacity * 0.5})`)
        glow.addColorStop(1, 'rgba(249, 231, 159, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(sparkle.x, sparkle.y, sparkle.size * 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    } else {
      ctx.fillStyle = '#c0392b'
      
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(PAPER_SIZE, 0)
      ctx.lineTo(PAPER_SIZE, PAPER_SIZE)
      ctx.lineTo(0, PAPER_SIZE)
      ctx.closePath()
      
      const cutPaths = cutLogicRef.current.getCutPaths()
      for (const path of cutPaths) {
        if (path.points.length < 2) continue
        ctx.moveTo(path.points[0].x, path.points[0].y)
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y)
        }
      }
      ctx.fill('evenodd')
      
      ctx.globalAlpha = 0.1
      for (let i = 0; i < 100; i++) {
        const x = Math.random() * PAPER_SIZE
        const y = Math.random() * PAPER_SIZE
        ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)'
        ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2)
      }
      ctx.globalAlpha = 1
    }
    
    if (template && templateOpacity > 0 && templateImageRef.current) {
      ctx.save()
      ctx.globalAlpha = templateOpacity * 0.6
      ctx.drawImage(templateImageRef.current, 0, 0)
      ctx.restore()
    }
    
    const currentPath = cutLogicRef.current.getCurrentPath()
    if (currentPath.length > 1) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(currentPath[0].x, currentPath[0].y)
      for (let i = 1; i < currentPath.length; i++) {
        ctx.lineTo(currentPath[i].x, currentPath[i].y)
      }
      ctx.stroke()
    }
    
    const allCutPaths = cutLogicRef.current.getCutPaths()
    for (const path of allCutPaths) {
      if (path.points.length < 2) continue
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(path.points[0].x, path.points[0].y)
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y)
      }
      ctx.stroke()
    }
    
    for (const particle of particlesRef.current) {
      ctx.save()
      ctx.translate(particle.x, particle.y)
      ctx.rotate(particle.rotation)
      ctx.fillStyle = `rgba(192, 57, 43, ${particle.opacity})`
      ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6)
      ctx.restore()
    }
  }, [template, templateOpacity, isCompleted])

  const animate = useCallback(() => {
    let needsRender = false
    
    if (particlesRef.current.length > 0) {
      particlesRef.current = particlesRef.current.filter(p => {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.1
        p.opacity -= 0.015
        p.rotation += p.rotationSpeed
        return p.opacity > 0 && p.y < PAPER_SIZE + 50
      })
      needsRender = true
    }
    
    if (isCompleted && sparklesRef.current.length > 0) {
      for (const sparkle of sparklesRef.current) {
        sparkle.opacity += sparkle.speed
        if (sparkle.opacity > 1 || sparkle.opacity < 0) {
          sparkle.speed = -sparkle.speed
        }
      }
      needsRender = true
    }
    
    if (needsRender) {
      render()
    }
    
    animationFrameRef.current = requestAnimationFrame(animate)
  }, [isCompleted, render])

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [animate])

  useEffect(() => {
    if (template) {
      cutLogicRef.current.setTemplate(template)
      createTemplateMask(template)
      setTemplateLoaded(false)
      setTemplateOpacity(0)
      
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${PAPER_SIZE}" height="${PAPER_SIZE}" viewBox="0 0 400 400">
          ${template.svgPath}
        </svg>
      `
      const img = new Image()
      img.onload = () => {
        templateImageRef.current = img
        setTemplateLoaded(true)
        requestAnimationFrame(() => {
          setTemplateOpacity(1)
        })
      }
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
      
      cutLogicRef.current.reset()
      setIsCompleted(false)
      onProgressChange(0)
      onUndoAvailable(false)
    }
  }, [template])

  useEffect(() => {
    cutLogicRef.current.setCompletionCallback((progress, completed) => {
      onProgressChange(progress)
      if (completed) {
        setIsCompleted(true)
        createSparkles()
        playGuzhengSound()
        onComplete()
      }
    })
  }, [onProgressChange, onComplete, createSparkles, playGuzhengSound])

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!template || isCompleted) return
    const pos = getMousePos(e)
    cutLogicRef.current.startDrawing(pos)
    onUndoAvailable(cutLogicRef.current.canUndo())
    render()
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!template || isCompleted) return
    const pos = getMousePos(e)
    cutLogicRef.current.continueDrawing(pos)
    render()
  }

  const handleMouseUp = () => {
    if (!template || isCompleted) return
    const path = cutLogicRef.current.endDrawing()
    if (path) {
      createParticles(path)
    }
    onUndoAvailable(cutLogicRef.current.canUndo())
  }

  useEffect(() => {
    render()
  }, [template, isCompleted])

  return (
    <div ref={containerRef} className="paper-container">
      <div className="paper-shadow"></div>
      <canvas
        ref={canvasRef}
        width={PAPER_SIZE}
        height={PAPER_SIZE}
        className="paper-canvas"
        style={{ transform: `scale(${scale})`, cursor: 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      
      <style>{`
        .paper-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: ${PAPER_SIZE * scale}px;
          height: ${PAPER_SIZE * scale}px;
        }
        
        .paper-shadow {
          position: absolute;
          width: ${PAPER_SIZE * scale}px;
          height: ${PAPER_SIZE * scale}px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          transform: translate(8px, 8px);
          filter: blur(10px);
          z-index: 0;
        }
        
        .paper-canvas {
          position: relative;
          z-index: 1;
          border-radius: 2px;
          box-shadow: 
            inset 0 0 20px rgba(0, 0, 0, 0.1),
            0 4px 20px rgba(0, 0, 0, 0.3);
          transition: opacity 0.3s ease;
          touch-action: none;
        }
        
        @media (max-width: 768px) {
          .paper-container,
          .paper-shadow {
            width: ${PAPER_SIZE * scale * 0.7}px;
            height: ${PAPER_SIZE * scale * 0.7}px;
          }
        }
      `}</style>
    </div>
  )
})

PaperCanvas.displayName = 'PaperCanvas'

export default PaperCanvas
