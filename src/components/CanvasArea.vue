<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { ToolType, Point, DrawOperation, StickyNoteData } from '@/types'
import { GRID_SIZE } from '@/types'

interface Props {
  currentTool: ToolType
  currentColor: string
  lineWidth: number
  operations: DrawOperation[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'drawComplete', operation: DrawOperation): void
  (e: 'canvasClick', point: Point): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const isDrawing = ref(false)
const currentPoints = ref<Point[]>([])
const startPoint = ref<Point | null>(null)
const currentMousePos = ref<Point | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let animationFrameId: number | null = null

function getCanvasPoint(event: MouseEvent): Point {
  if (!canvasRef.value) return { x: 0, y: 0 }
  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }
}

function drawGrid() {
  if (!ctx || !canvasRef.value) return
  const width = canvasRef.value.width
  const height = canvasRef.value.height

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = '#f0f0f0'
  ctx.lineWidth = 1

  for (let x = 0; x <= width; x += GRID_SIZE) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }

  for (let y = 0; y <= height; y += GRID_SIZE) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
}

function drawOperation(operation: DrawOperation) {
  if (!ctx) return
  ctx.strokeStyle = operation.color
  ctx.lineWidth = operation.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (operation.type === 'pen' && operation.points && operation.points.length > 1) {
    ctx.beginPath()
    ctx.moveTo(operation.points[0].x, operation.points[0].y)
    for (let i = 1; i < operation.points.length; i++) {
      ctx.lineTo(operation.points[i].x, operation.points[i].y)
    }
    ctx.stroke()
  } else if (operation.type === 'rectangle' && operation.startPoint && operation.endPoint) {
    const width = operation.endPoint.x - operation.startPoint.x
    const height = operation.endPoint.y - operation.startPoint.y
    ctx.strokeRect(operation.startPoint.x, operation.startPoint.y, width, height)
  } else if (operation.type === 'circle' && operation.startPoint && operation.endPoint) {
    const radiusX = Math.abs(operation.endPoint.x - operation.startPoint.x) / 2
    const radiusY = Math.abs(operation.endPoint.y - operation.startPoint.y) / 2
    const centerX = operation.startPoint.x + (operation.endPoint.x - operation.startPoint.x) / 2
    const centerY = operation.startPoint.y + (operation.endPoint.y - operation.startPoint.y) / 2
    ctx.beginPath()
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawPreview() {
  if (!ctx || !startPoint.value || !currentMousePos.value) return
  ctx.strokeStyle = props.currentColor
  ctx.lineWidth = props.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([5, 5])

  if (props.currentTool === 'pen' && currentPoints.value.length > 1) {
    ctx.beginPath()
    ctx.moveTo(currentPoints.value[0].x, currentPoints.value[0].y)
    for (let i = 1; i < currentPoints.value.length; i++) {
      ctx.lineTo(currentPoints.value[i].x, currentPoints.value[i].y)
    }
    ctx.stroke()
  } else if (props.currentTool === 'rectangle') {
    const width = currentMousePos.value.x - startPoint.value.x
    const height = currentMousePos.value.y - startPoint.value.y
    ctx.strokeRect(startPoint.value.x, startPoint.value.y, width, height)
  } else if (props.currentTool === 'circle') {
    const radiusX = Math.abs(currentMousePos.value.x - startPoint.value.x) / 2
    const radiusY = Math.abs(currentMousePos.value.y - startPoint.value.y) / 2
    const centerX = startPoint.value.x + (currentMousePos.value.x - startPoint.value.x) / 2
    const centerY = startPoint.value.y + (currentMousePos.value.y - startPoint.value.y) / 2
    ctx.beginPath()
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.setLineDash([])
}

function redrawAll() {
  if (!ctx || !canvasRef.value) return
  drawGrid()
  props.operations.forEach((op) => drawOperation(op))
  if (isDrawing.value) {
    drawPreview()
  }
}

function startDrawing(event: MouseEvent) {
  if (props.currentTool === 'select' || props.currentTool === 'note') {
    const point = getCanvasPoint(event)
    emit('canvasClick', point)
    return
  }

  isDrawing.value = true
  const point = getCanvasPoint(event)
  startPoint.value = point
  currentMousePos.value = point
  currentPoints.value = [point]
}

function draw(event: MouseEvent) {
  if (!isDrawing.value) return
  const point = getCanvasPoint(event)
  currentMousePos.value = point

  if (props.currentTool === 'pen') {
    currentPoints.value.push(point)
  }

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
  }
  animationFrameId = requestAnimationFrame(redrawAll)
}

function finishDrawing() {
  if (!isDrawing.value || !startPoint.value || !currentMousePos.value) {
    isDrawing.value = false
    return
  }

  isDrawing.value = false

  if (props.currentTool === 'pen' && currentPoints.value.length < 2) {
    startPoint.value = null
    currentMousePos.value = null
    currentPoints.value = []
    return
  }

  const operation: DrawOperation = {
    id: generateId(),
    type: props.currentTool as 'pen' | 'rectangle' | 'circle',
    userId: '',
    color: props.currentColor,
    lineWidth: props.lineWidth,
    timestamp: Date.now()
  }

  if (props.currentTool === 'pen') {
    operation.points = [...currentPoints.value]
  } else {
    operation.startPoint = { ...startPoint.value }
    operation.endPoint = { ...currentMousePos.value }
  }

  emit('drawComplete', operation)

  startPoint.value = null
  currentMousePos.value = null
  currentPoints.value = []

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
  }
  redrawAll()
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

function resizeCanvas() {
  if (!canvasRef.value || !containerRef.value) return
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  canvasRef.value.width = width
  canvasRef.value.height = height
  redrawAll()
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (isDrawing.value) {
      isDrawing.value = false
      startPoint.value = null
      currentMousePos.value = null
      currentPoints.value = []
      redrawAll()
    }
  }
}

watch(
  () => props.operations,
  () => {
    redrawAll()
  },
  { deep: true }
)

onMounted(() => {
  nextTick(() => {
    if (canvasRef.value) {
      ctx = canvasRef.value.getContext('2d')
      resizeCanvas()
    }
    window.addEventListener('resize', resizeCanvas)
    window.addEventListener('keydown', handleKeyDown)
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
  window.removeEventListener('keydown', handleKeyDown)
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
  }
})

defineExpose({
  redrawAll,
  clearCanvas: () => {
    if (ctx && canvasRef.value) {
      ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height)
      drawGrid()
    }
  }
})
</script>

<template>
  <div ref="containerRef" class="canvas-container">
    <canvas
      ref="canvasRef"
      class="canvas"
      @mousedown="startDrawing"
      @mousemove="draw"
      @mouseup="finishDrawing"
      @mouseleave="finishDrawing"
    />
  </div>
</template>

<style scoped>
.canvas-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.canvas {
  display: block;
  cursor: crosshair;
}

.canvas-container :deep(.canvas) {
  touch-action: none;
}
</style>
