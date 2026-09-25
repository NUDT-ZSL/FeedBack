import React, { useRef, useEffect, useCallback, useState } from 'react'

interface WaveformEditorProps {
  audioData: Float32Array | number[]
  inPoint: number
  outPoint: number
  zoomLevel: number
  duration: number
  onInPointChange: (time: number) => void
  onOutPointChange: (time: number) => void
  onZoomLevelChange: (zoom: number) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 20
const ZOOM_STEP = 1.1
const TRIANGLE_SIZE = 12
const GRID_SPACING = 50

type DragType = 'in' | 'out' | null

export default function WaveformEditor({
  audioData,
  inPoint,
  outPoint,
  zoomLevel,
  duration,
  onInPointChange,
  onOutPointChange,
  onZoomLevelChange,
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animationFrameRef = useRef<number>(0)
  const [dragging, setDragging] = useState<DragType>(null)
  const [hoveredMarker, setHoveredMarker] = useState<DragType>(null)
  const [displayZoom, setDisplayZoom] = useState(zoomLevel)
  const lastRenderTimeRef = useRef<number>(0)
  const mouseXRef = useRef<number>(0)

  const timeToX = useCallback(
    (time: number, width: number) => {
      return (time / duration) * width * zoomLevel
    },
    [duration, zoomLevel]
  )

  const xToTime = useCallback(
    (x: number, width: number) => {
      return Math.max(0, Math.min(duration, (x / (width * zoomLevel)) * duration))
    },
    [duration, zoomLevel]
  )

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    const width = rect.width
    const height = rect.height

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.lineWidth = 1
    for (let x = 0; x < width; x += GRID_SPACING) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = 0; y < height; y += GRID_SPACING) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    if (!audioData || audioData.length === 0) return

    const visibleWidth = width * zoomLevel
    const samplesPerPixel = Math.max(1, Math.floor(audioData.length / visibleWidth))

    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, 'rgba(100, 180, 255, 0.9)')
    gradient.addColorStop(0.5, 'rgba(147, 197, 253, 0.7)')
    gradient.addColorStop(1, 'rgba(191, 219, 254, 0.4)')

    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(0, height / 2)

    for (let x = 0; x < width; x++) {
      const sampleIndex = Math.floor(x * samplesPerPixel)
      if (sampleIndex >= audioData.length) break

      let min = 0
      let max = 0
      const endIndex = Math.min(sampleIndex + samplesPerPixel, audioData.length)
      for (let i = sampleIndex; i < endIndex; i++) {
        const val = audioData[i]
        if (val < min) min = val
        if (val > max) max = val
      }

      const yMin = (1 - (max + 1) / 2) * height

      ctx.lineTo(x, yMin)
    }

    for (let x = width - 1; x >= 0; x--) {
      const sampleIndex = Math.floor(x * samplesPerPixel)
      if (sampleIndex >= audioData.length) break

      let min = 0
      let max = 0
      const endIndex = Math.min(sampleIndex + samplesPerPixel, audioData.length)
      for (let i = sampleIndex; i < endIndex; i++) {
        const val = audioData[i]
        if (val < min) min = val
        if (val > max) max = val
      }

      const yMax = (1 - (min + 1) / 2) * height

      ctx.lineTo(x, yMax)
    }

    ctx.closePath()
    ctx.fill()

    const inX = timeToX(inPoint, width)
    const outX = timeToX(outPoint, width)

    if (inX < outX && inX < width && outX > 0) {
      const highlightStart = Math.max(0, inX)
      const highlightEnd = Math.min(width, outX)
      ctx.fillStyle = 'rgba(34, 197, 94, 0.3)'
      ctx.fillRect(highlightStart, 0, highlightEnd - highlightStart, height)
    }

    const drawTriangle = (x: number, isIn: boolean) => {
      const isHovered = hoveredMarker === (isIn ? 'in' : 'out')
      const isDragging = dragging === (isIn ? 'in' : 'out')
      const color = isHovered || isDragging ? '#facc15' : '#3b82f6'

      ctx.fillStyle = color
      ctx.beginPath()
      if (isIn) {
        ctx.moveTo(x - TRIANGLE_SIZE, 0)
        ctx.lineTo(x, 0)
        ctx.lineTo(x - TRIANGLE_SIZE, TRIANGLE_SIZE)
      } else {
        ctx.moveTo(x, 0)
        ctx.lineTo(x + TRIANGLE_SIZE, 0)
        ctx.lineTo(x + TRIANGLE_SIZE, TRIANGLE_SIZE)
      }
      ctx.closePath()
      ctx.fill()

      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()

      if (isDragging) {
        const time = isIn ? inPoint : outPoint
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
        const text = `${time.toFixed(1)}s`
        ctx.font = '12px monospace'
        const textWidth = ctx.measureText(text).width
        const textX = isIn ? x - TRIANGLE_SIZE - textWidth - 8 : x + TRIANGLE_SIZE + 8
        ctx.fillRect(textX - 4, 4, textWidth + 8, 20)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(text, textX, 19)
      }
    }

    if (inX >= 0 && inX <= width) {
      drawTriangle(inX, true)
    }
    if (outX >= 0 && outX <= width) {
      drawTriangle(outX, false)
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(8, 8, 80, 24)
    ctx.fillStyle = '#ffffff'
    ctx.font = '12px monospace'
    ctx.fillText(`${displayZoom.toFixed(1)}x`, 16, 25)
  }, [audioData, inPoint, outPoint, zoomLevel, displayZoom, hoveredMarker, dragging, timeToX])

  const render = useCallback(() => {
    const now = performance.now()
    if (now - lastRenderTimeRef.current >= 16) {
      drawWaveform()
      lastRenderTimeRef.current = now
    }
    animationFrameRef.current = requestAnimationFrame(render)
  }, [drawWaveform])

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(animationFrameRef.current)
    }
  }, [render])

  useEffect(() => {
    let start = displayZoom
    const end = zoomLevel
    const startTime = performance.now()
    const duration = 200

    const animate = () => {
      const now = performance.now()
      const progress = Math.min(1, (now - startTime) / duration)
      const easeProgress = 1 - Math.pow(1 - progress, 3)
      setDisplayZoom(start + (end - start) * easeProgress)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }
    requestAnimationFrame(animate)
  }, [zoomLevel])

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel * delta))
      onZoomLevelChange(newZoom)
    },
    [zoomLevel, onZoomLevelChange]
  )

  const isNearMarker = useCallback(
    (mouseX: number, markerX: number) => {
      return Math.abs(mouseX - markerX) < TRIANGLE_SIZE + 4
    },
    []
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const width = rect.width
      const inX = timeToX(inPoint, width)
      const outX = timeToX(outPoint, width)

      if (isNearMarker(mouseX, inX)) {
        setDragging('in')
      } else if (isNearMarker(mouseX, outX)) {
        setDragging('out')
      }
    },
    [inPoint, outPoint, timeToX, isNearMarker]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      mouseXRef.current = mouseX
      const width = rect.width

      if (dragging) {
        const time = xToTime(mouseX, width)
        if (dragging === 'in') {
          if (time < outPoint) {
            onInPointChange(time)
          }
        } else if (dragging === 'out') {
          if (time > inPoint) {
            onOutPointChange(time)
          }
        }
      } else {
        const inX = timeToX(inPoint, width)
        const outX = timeToX(outPoint, width)

        if (isNearMarker(mouseX, inX)) {
          setHoveredMarker('in')
          canvas.style.cursor = 'ew-resize'
        } else if (isNearMarker(mouseX, outX)) {
          setHoveredMarker('out')
          canvas.style.cursor = 'ew-resize'
        } else {
          setHoveredMarker(null)
          canvas.style.cursor = 'default'
        }
      }
    },
    [dragging, inPoint, outPoint, timeToX, xToTime, isNearMarker, onInPointChange, onOutPointChange]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setDragging(null)
    setHoveredMarker(null)
    const canvas = canvasRef.current
    if (canvas) {
      canvas.style.cursor = 'default'
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-gray-900 rounded-lg overflow-hidden"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  )
}
