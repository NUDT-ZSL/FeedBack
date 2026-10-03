import React, { useRef, useEffect, useState, useCallback } from 'react'
import type { GridSize } from './types'
import {
  CANVAS_SIZE,
  PixelBoard,
  brushCells,
  hexToRgba,
  renderGrid,
  renderHoverPreview,
} from './pixelBoard'

interface PixelCanvasProps {
  color: string
  opacity: number
  brushSize: number
  gridSize: GridSize
  onGridSizeChange: (size: GridSize) => void
  getCanvasDataRef: React.MutableRefObject<(() => string) | null>
  clearCanvasRef: React.MutableRefObject<(() => void) | null>
}

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
  const boardRef = useRef<PixelBoard | null>(null)
  if (!boardRef.current) {
    boardRef.current = new PixelBoard(gridSize)
  }
  const board = boardRef.current
  const rafRef = useRef<number | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null)

  const renderFrame = useCallback(
    (now: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (ctx) {
        board.renderTo(ctx, now)
      }
      if (board.hasActiveAnimations(now)) {
        rafRef.current = requestAnimationFrame(renderFrame)
      } else {
        rafRef.current = null
      }
    },
    [board]
  )

  const scheduleRender = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(renderFrame)
    }
  }, [renderFrame])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  const redrawOverlayGrid = useCallback(() => {
    const overlay = overlayRef.current
    const ctx = overlay?.getContext('2d')
    if (ctx) {
      renderGrid(ctx, board.gridSize)
    }
  }, [board])

  const clearCanvas = useCallback(() => {
    board.clear()
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      board.renderTo(ctx, performance.now())
    }
  }, [board])

  useEffect(() => {
    clearCanvasRef.current = clearCanvas
  }, [clearCanvas, clearCanvasRef])

  const exportData = useCallback(() => {
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = CANVAS_SIZE
    exportCanvas.height = CANVAS_SIZE
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) return ''
    board.renderSettledTo(ctx)
    return exportCanvas.toDataURL('image/png')
  }, [board])

  useEffect(() => {
    getCanvasDataRef.current = exportData
  }, [exportData, getCanvasDataRef])

  useEffect(() => {
    board.setGridSize(gridSize)
    scheduleRender()
    redrawOverlayGrid()
  }, [gridSize, board, scheduleRender, redrawOverlayGrid])

  const paintAtPosition = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const scaleX = CANVAS_SIZE / rect.width
      const scaleY = CANVAS_SIZE / rect.height
      const x = (clientX - rect.left) * scaleX
      const y = (clientY - rect.top) * scaleY
      const size = board.cellSize
      const centerGridX = Math.floor(x / size)
      const centerGridY = Math.floor(y / size)
      const rgba = color.startsWith('#') ? hexToRgba(color, opacity) : color
      const painted = board.paint(
        brushCells(centerGridX, centerGridY, brushSize),
        rgba,
        performance.now()
      )
      if (painted > 0) {
        scheduleRender()
      }
    },
    [board, color, opacity, brushSize, scheduleRender]
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
        paintAtPosition(rect.left + x / scaleX, rect.top + y / scaleY)
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
    [paintAtPosition]
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
    paintAtPosition(e.clientX, e.clientY)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_SIZE / rect.width
    const scaleY = CANVAS_SIZE / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    const size = board.cellSize
    const gridX = Math.floor(x / size)
    const gridY = Math.floor(y / size)
    if (isDrawing) {
      if (lastDrawPosRef.current) {
        drawLine(lastDrawPosRef.current.x, lastDrawPosRef.current.y, x, y)
      } else {
        paintAtPosition(e.clientX, e.clientY)
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
    redrawOverlayGrid()
  }

  const drawHoverPreview = (gridX: number, gridY: number) => {
    const overlay = overlayRef.current
    const ctx = overlay?.getContext('2d')
    if (!ctx) return
    renderHoverPreview(ctx, {
      gridSize: board.gridSize,
      brushSize,
      color,
      opacity,
      hoverX: gridX,
      hoverY: gridY,
    })
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
            cursor: 'crosshair',
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
