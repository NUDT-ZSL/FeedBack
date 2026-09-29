export type VizMode = 'waveform' | 'spectrum'

export interface AnalyzerDataSource {
  getTimeDomainData(): Uint8Array
  getFrequencyData(): Uint8Array
}

export interface SceneParams {
  analyzer: AnalyzerDataSource | null
  isPlaying: boolean
  isSeeking: boolean
  mode: VizMode
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Pure scene renderer: draws one frame into ctx using only the provided
 * params. All coordinates are guaranteed to stay within
 * [0, width] x [0, height] for any positive width/height.
 */
export function drawScene(ctx: CanvasRenderingContext2D, params: SceneParams): void {
  const { width, height } = params

  ctx.fillStyle = '#0f0f23'
  ctx.fillRect(0, 0, width, height)

  if (params.analyzer && params.isPlaying && !params.isSeeking) {
    if (params.mode === 'waveform') {
      drawWaveform(ctx, params.analyzer, width, height)
    } else {
      drawSpectrum(ctx, params.analyzer, width, height)
    }
  } else {
    drawIdleLine(ctx, width, height)
  }
}

export function drawIdleLine(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, height / 2)
  ctx.lineTo(width, height / 2)
  ctx.stroke()
}

export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  analyzer: AnalyzerDataSource,
  width: number,
  height: number,
): void {
  const data = analyzer.getTimeDomainData()
  if (data.length === 0) return
  const sliceWidth = width / data.length

  ctx.lineWidth = 2
  ctx.strokeStyle = '#22c55e'
  ctx.beginPath()

  let x = 0
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0
    const y = clamp((v * height) / 2, 0, height)
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

export function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  analyzer: AnalyzerDataSource,
  width: number,
  height: number,
): void {
  const data = analyzer.getFrequencyData()
  if (data.length === 0) return
  const usableBins = Math.max(1, Math.floor(data.length * 0.6))
  const barCount = Math.min(64, usableBins)
  const barWidth = width / barCount
  const gap = Math.max(1, barWidth * 0.15)
  const actualBarWidth = Math.max(0, barWidth - gap)

  for (let i = 0; i < barCount; i++) {
    const dataIndex = Math.min(data.length - 1, Math.floor((i / barCount) * usableBins))
    const value = clamp(data[dataIndex] / 255, 0, 1)
    const barHeight = value * height

    const x = clamp(i * barWidth + gap / 2, 0, width)
    const y = clamp(height - barHeight, 0, height)

    const gradient = ctx.createLinearGradient(0, height, 0, y)
    gradient.addColorStop(0, '#3b82f6')
    gradient.addColorStop(0.5, '#ef4444')
    gradient.addColorStop(1, '#f97316')

    ctx.fillStyle = gradient
    ctx.fillRect(x, y, Math.min(actualBarWidth, width - x), barHeight)
  }
}
