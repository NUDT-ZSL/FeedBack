import React, { useRef, useEffect, useState, useCallback } from 'react'
import type { GridSize } from './types'

interface PixelCanvasProps {
  color: string
  opacity: number
  brushSize: number
  gridSize: GridSize
  onGridSizeChange: (size: GridSize) => void
  getCanvasDataRef: React.MutableRefObject<(() => string) | null>
  clearCanvasRef: React.MutableRefObject<(() => void) | null>
}

const CANVAS_SIZE = 400

const PixelCanvas: React.FC<PixelCanvasProps> = ({
  color,
  opacity,
  brushSize,
  gridSize,
  onGridSizeChange,
  getCanvasDataRef,
  clearCanvasRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const animatingCellsRef = useRef<Map<string, { startTime: number; color: string }>>(new Map())
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null)

  const getCellSize = useCallback(() => CANVAS_SIZE / gridSize, [gridSize])

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    animatingCellsRef.current.clear()
  }, [])

  useEffect(() => {
    clearCanvasRef.current = clearCanvas
  }, [clearCanvas, clearCanvasRef])

  const exportData = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return ''
    return canvas.toDataURL('image/png')
  }, [])

  useEffect(() => {
    getCanvasDataRef.current = exportData
  }, [exportData, getCanvasDataRef])

  const drawGrid = useCallback(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    const cellSize = getCellSize()
    ctx.strokeStyle = 'rgba(212, 201, 176, 0.3)'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= gridSize; i++) {
      ctx.beginPath()
      ctx.moveTo(i * cellSize, 0)
      ctx.lineTo(i * cellSize, CANVAS_SIZE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * cellSize)
      ctx.lineTo(CANVAS_SIZE, i * cellSize)
      ctx.stroke()
    }
  }, [gridSize, getCellSize])

  useEffect(() => {
    drawGrid()
    clearCanvas()
  }, [gridSize, drawGrid, clearCanvas])

  const fillCellWithAnimation = useCallback(
    (gridX: number, gridY: number, fillColor: string) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const cellSize = getCellSize()
      const key = `${gridX},${gridY}`
      animatingCellsRef.current.set(key, {
        startTime: performance.now(),
        color: fillColor,
      })
      const centerX = gridX * cellSize + cellSize / 2
      const centerY = gridY * cellSize + cellSize / 2
      const maxRadius = cellSize / 2
      const animate = (time: number) => {
        const entry = animatingCellsRef.current.get(key)
        if (!entry) return
        const elapsed = time - entry.startTime
        const duration = 150
        const progress = Math.min(elapsed / duration, 1)
        const easeOut = 1 - Math.pow(1 - progress, 3)
        const currentRadius = maxRadius * easeOut
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.save()
        ctx.beginPath()
        ctx.rect(gridX * cellSize, gridY * cellSize, cellSize, cellSize)
        ctx.clip()
        ctx.fillStyle = entry.color
        ctx.beginPath()
        ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          ctx.fillStyle = entry.color
          ctx.fillRect(gridX * cellSize, gridY * cellSize, cellSize, cellSize)
          animatingCellsRef.current.delete(key)
        }
      }
      requestAnimationFrame(animate)
    },
    [getCellSize]
  )

  const drawAtPosition = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const scaleX = CANVAS_SIZE / rect.width
      const scaleY = CANVAS_SIZE / rect.height
      const x = (clientX - rect.left) * scaleX
      const y = (clientY - rect.top) * scaleY
      const cellSize = getCellSize()
      const centerGridX = Math.floor(x / cellSize)
      const centerGridY = Math.floor(y / cellSize)
      const halfBrush = Math.floor(brushSize / 2)
      const rgba = color.startsWith('#') ? hexToRgba(color, opacity) : color
      for (let dx = -halfBrush; dx <= halfBrush; dx++) {
        for (let dy = -halfBrush; dy <= halfBrush; dy++) {
          if (brushSize % 2 === 0 && (dx === halfBrush || dy === halfBrush)) continue
          const gx = centerGridX + dx
          const gy = centerGridY + dy
          if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
            fillCellWithAnimation(gx, gy, rgba)
          }
        }
      }
    },
    [color, opacity, brushSize, gridSize, getCellSize, fillCellWithAnimation]
  )

  const drawLine = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      const dx = Math.abs(x1 - x0)
      const dy = Math.abs(y1 - y0)
      const sx = x0 < x1 ? 1 : -1
      const sy = y0 < y1 ? 1 : -1
      let err = dx - dy
      let x = x0
      let y = y0
      const maxSteps = 100
      let steps = 0
      while (steps < maxSteps) {
        const canvas = canvasRef.current
        if (!canvas) break
        const rect = canvas.getBoundingClientRect()
        const scaleX = CANVAS_SIZE / rect.width
        const scaleY = CANVAS_SIZE / rect.height
        drawAtPosition(rect.left + x / scaleX, rect.top + y / scaleY)
        if (x === x1 && y === y1) break
        const e2 = 2 * err
        if (e2 > -dy) {
          err -= dy
          x += sx
        }
        if (e2 < dx) {
          err += dx
          y += sy
        }
        steps++
      }
    },
    [drawAtPosition]
  )

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true)
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_SIZE / rect.width
    const scaleY = CANVAS_SIZE / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    lastDrawPosRef.current = { x, y }
    drawAtPosition(e.clientX, e.clientY)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_SIZE / rect.width
    const scaleY = CANVAS_SIZE / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    const cellSize = getCellSize()
    const gridX = Math.floor(x / cellSize)
    const gridY = Math.floor(y / cellSize)
    if (isDrawing) {
      if (lastDrawPosRef.current) {
        drawLine(lastDrawPosRef.current.x, lastDrawPosRef.current.y, x, y)
      } else {
        drawAtPosition(e.clientX, e.clientY)
      }
      lastDrawPosRef.current = { x, y }
    }
    drawHoverPreview(gridX, gridY)
  }

  const handleMouseUp = () => {
    setIsDrawing(false)
    lastDrawPosRef.current = null
  }

  const handleMouseLeave = () => {
    setIsDrawing(false)
    lastDrawPosRef.current = null
    clearHoverPreview()
  }

  const drawHoverPreview = (gridX: number, gridY: number) => {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    drawGrid()
    const cellSize = getCellSize()
    const halfBrush = Math.floor(brushSize / 2)
    for (let dx = -halfBrush; dx <= halfBrush; dx++) {
      for (let dy = -halfBrush; dy <= halfBrush; dy++) {
        if (brushSize % 2 === 0 && (dx === halfBrush || dy === halfBrush)) continue
        const gx = gridX + dx
        const gy = gridY + dy
        if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
          const px = gx * cellSize
          const py = gy * cellSize
          const scale = 1.2
          const offset = cellSize * (scale - 1) / 2
          ctx.save()
          ctx.fillStyle = hexToRgba(color, opacity * 0.5)
          ctx.fillRect(px - offset, py - offset, cellSize * scale, cellSize * scale)
          ctx.restore()
        }
      }
    }
  }

  const clearHoverPreview = () => {
    drawGrid()
  }

  const getCursorStyle = (): React.CSSProperties => {
    const cellSize = getCellSize()
    const size = cellSize * brushSize * 1.5
    return {
      cursor: `crosshair`,
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.gridSizeSelector}>
        {[16, 32, 64].map((size) => (
          <button
            key={size}
            onClick={() => onGridSizeChange(size as GridSize)}
            style={{
              ...styles.gridSizeBtn,
              ...(gridSize === size ? styles.gridSizeBtnActive : {}),
            }}
          >
            {size}x{size}
          </button>
        ))}
      </div>
      <div
        style={{
          position: 'relative',
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          border: `2px solid #d4c9b0`,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            ...getCursorStyle(),
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
        <canvas
          ref={overlayRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return hex
  const r = parseInt(result[1], 16)
  const g = parseInt(result[2], 16)
  const b = parseInt(result[3], 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  gridSizeSelector: {
    display: 'flex',
    gap: 8,
    backgroundColor: '#fff',
    padding: 6,
    borderRadius: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  gridSizeBtn: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: 8,
    backgroundColor: 'transparent',
    color: '#5a4a3a',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  gridSizeBtnActive: {
    backgroundColor: '#d4c9b0',
    color: '#fff',
  },
}

export default PixelCanvas
