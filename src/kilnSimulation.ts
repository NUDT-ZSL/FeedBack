import { TextureData, TempPoint, GlazeStroke, GlazeType, TextureSpot } from './store'
import {
  GlazeComposition,
  buildGlazeComposition,
  hashStrokes,
  fnv1aHash,
} from './glazeComposition'

export const HEAT_DURATION = 10
export const COOL_DURATION = 8
export const FIRING_STEP = 0.1

export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export const hexToRgb01 = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return [1, 1, 1]
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
}

const rgb01ToHex = (r: number, g: number, b: number): string => {
  const toByte = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

export const calculateTemperatureCurve = (
  elapsedTime: number,
  targetTemp: number,
  totalDuration: number = HEAT_DURATION
): number => {
  const progress = Math.min(elapsedTime / totalDuration, 1)
  const baseTemp = 25 + (targetTemp - 25) * progress
  const waveAmplitude = targetTemp * 0.05
  const waveFrequency = 4
  const fluctuation = Math.sin(progress * Math.PI * waveFrequency) * waveAmplitude
  return Math.round(baseTemp + fluctuation)
}

export const calculateCoolingCurve = (
  elapsedTime: number,
  startTemp: number,
  totalDuration: number = COOL_DURATION
): number => {
  const progress = Math.min(elapsedTime / totalDuration, 1)
  const cooledTemp = startTemp - (startTemp - 200) * progress
  return Math.max(25, Math.round(cooledTemp))
}

export const getFireColor = (temp: number): string => {
  const normalizedTemp = Math.max(0, Math.min(1, (temp - 500) / 1000))
  const r = 255
  const g = Math.round(69 + normalizedTemp * 186)
  const b = Math.round(normalizedTemp * 255)
  return `rgb(${r}, ${g}, ${b})`
}

export const buildCanonicalFiringHistory = (
  targetTemp: number,
  heatDuration: number = HEAT_DURATION,
  coolDuration: number = COOL_DURATION,
  step: number = FIRING_STEP
): TempPoint[] => {
  const history: TempPoint[] = []
  let peakTemp = 25

  const heatSteps = Math.round(heatDuration / step)
  for (let i = 0; i <= heatSteps; i++) {
    const t = round4(i * step)
    const temp = calculateTemperatureCurve(t, targetTemp, heatDuration)
    peakTemp = Math.max(peakTemp, temp)
    history.push({ time: t, temp })
  }

  const coolSteps = Math.round(coolDuration / step)
  for (let i = 1; i <= coolSteps; i++) {
    const dt = round4(i * step)
    history.push({
      time: round4(heatDuration + dt),
      temp: calculateCoolingCurve(dt, peakTemp, coolDuration),
    })
  }

  return history
}

export const hashTempHistory = (history: TempPoint[]): number => {
  const canonical = history.map(p => [round4(p.time), Math.round(p.temp)])
  return fnv1aHash(JSON.stringify(canonical))
}

export const getPeakTemp = (history: TempPoint[]): number =>
  history.reduce((max, p) => Math.max(max, p.temp), 25)

export const glazeActivation = (glaze: GlazeType, peakTemp: number): number => {
  if (peakTemp < glaze.tempRange[0]) return 0
  if (peakTemp >= glaze.tempRange[1]) return 1
  return clamp01((peakTemp - glaze.tempRange[0]) / (glaze.tempRange[1] - glaze.tempRange[0]))
}

const TYPE_THRESHOLDS: { type: TextureData['type']; minTemp: number }[] = [
  { type: 'yohen', minTemp: 1250 },
  { type: 'oil', minTemp: 1170 },
  { type: 'rabbit', minTemp: 1080 },
]

const TYPE_PARAMS: Record<string, { density: number; minSize: number; maxSize: number }> = {
  rabbit: { density: 0.2, minSize: 0.004, maxSize: 0.012 },
  oil: { density: 0.13, minSize: 0.012, maxSize: 0.03 },
  yohen: { density: 0.09, minSize: 0.02, maxSize: 0.05 },
}

const resolveType = (peakTemp: number): TextureData['type'] => {
  for (const t of TYPE_THRESHOLDS) {
    if (peakTemp >= t.minTemp) return t.type
  }
  return 'none'
}

export interface FiringResult extends TextureData {
  peakTemp: number
}

export const simulateFiring = (
  composition: GlazeComposition,
  glazes: GlazeType[],
  tempHistory: TempPoint[],
  seed: number
): FiringResult => {
  const peakTemp = getPeakTemp(tempHistory)
  const activationById = new Map<string, number>()
  const nameById = new Map(glazes.map(g => [g.id, g.name]))

  glazes.forEach(g => {
    activationById.set(g.id, glazeActivation(g, peakTemp))
  })

  const thicknessSum: Record<string, number> = {}
  const thicknessCount: Record<string, number> = {}
  composition.cells.forEach(cell => {
    cell.layers.forEach(layer => {
      thicknessSum[layer.glazeId] = (thicknessSum[layer.glazeId] || 0) + layer.thickness
      thicknessCount[layer.glazeId] = (thicknessCount[layer.glazeId] || 0) + 1
    })
  })

  const spotCounts: Record<string, number> = {}
  const spots: TextureSpot[] = []
  let weightedIntensity = 0

  const anyActive = glazes.some(g => (activationById.get(g.id) || 0) > 0)
  const type = anyActive && composition.cells.length > 0 ? resolveType(peakTemp) : 'none'

  if (type !== 'none') {
    const params = TYPE_PARAMS[type]
    const rng = mulberry32(seed >>> 0)
    const cellSize = 1 / composition.gridSize

    composition.cells.forEach(cell => {
      const activeLayers = cell.layers.filter(l => (activationById.get(l.glazeId) || 0) > 0)
      const topActive = activeLayers[activeLayers.length - 1]

      if (!topActive) return

      const activation = activationById.get(topActive.glazeId) || 0
      const thicknessRatio = clamp01(cell.totalThickness / 0.5)
      weightedIntensity += activation * thicknessRatio

      const emitProbability = clamp01(params.density * activation * (0.4 + thicknessRatio))
      if (rng() >= emitProbability) return

      const glaze = glazes.find(g => g.id === topActive.glazeId)
      if (!glaze) return

      const x = round4(cell.u + (rng() - 0.5) * cellSize * 0.8)
      const y = round4(cell.v + (rng() - 0.5) * cellSize * 0.8)
      const sizeRoll = rng()
      const size = round4(
        (params.minSize + sizeRoll * (params.maxSize - params.minSize)) *
          (0.6 + cell.totalThickness * 0.8) *
          (0.6 + activation * 0.6)
      )

      const [br, bg, bb] = hexToRgb01(glaze.color)
      const shade = 0.85 + rng() * 0.3
      const warm = (rng() - 0.5) * 0.12
      const color = rgb01ToHex(
        br * shade + warm,
        bg * shade,
        bb * shade - warm
      )

      spots.push({
        x,
        y,
        size,
        color,
        glazeId: glaze.id,
        layerOrder: topActive.order,
        thickness: round4(cell.totalThickness),
        activation: round4(activation),
      })
      spotCounts[glaze.id] = (spotCounts[glaze.id] || 0) + 1
    })
  }

  const coveredCells = composition.cells.length
  let intensity = 0
  if (coveredCells > 0) {
    intensity = round4(clamp01(weightedIntensity / coveredCells))
  }

  if (spots.length === 0 || intensity === 0) {
    intensity = 0
  }

  const finalType = intensity === 0 || spots.length === 0 ? 'none' : type

  const contributions = glazes
    .filter(g => composition.glazeCoverage[g.id] !== undefined)
    .map(g => {
      const count = thicknessCount[g.id] || 0
      return {
        glazeId: g.id,
        name: nameById.get(g.id) || g.name,
        activation: round4(activationById.get(g.id) || 0),
        coverage: round4(composition.glazeCoverage[g.id] || 0),
        avgThickness: count > 0 ? round4((thicknessSum[g.id] || 0) / count) : 0,
        spotCount: spotCounts[g.id] || 0,
      }
    })

  const dominant = contributions
    .filter(c => c.spotCount > 0)
    .sort((a, b) => b.spotCount - a.spotCount)[0]
  const dominantGlaze = dominant ? glazes.find(g => g.id === dominant.glazeId) : undefined
  const colorVariation = dominantGlaze
    ? (() => { const [r, g, b] = hexToRgb01(dominantGlaze.color); return [round4(r), round4(g), round4(b)] })()
    : [0, 0, 0]

  return {
    type: finalType,
    intensity,
    colorVariation,
    spots,
    contributions,
    seed: seed >>> 0,
    peakTemp,
  }
}

export const simulateFiringFromStrokes = (
  strokes: GlazeStroke[],
  glazes: GlazeType[],
  tempHistory: TempPoint[],
  seedOverride?: number
): FiringResult => {
  const composition = buildGlazeComposition(strokes, glazes)
  const seed = seedOverride ?? deriveFiringSeed(strokes, tempHistory)
  return simulateFiring(composition, glazes, tempHistory, seed)
}

export const deriveFiringSeed = (strokes: GlazeStroke[], tempHistory: TempPoint[]): number => {
  const strokeSeed = hashStrokes(strokes)
  const historySeed = hashTempHistory(tempHistory)
  return Math.imul(strokeSeed ^ historySeed, 0x9e3779b9) >>> 0
}

export const generateTextureDescription = (textureData: TextureData): string => {
  const { type, intensity, spots, contributions } = textureData

  if (type === 'none' || intensity === 0 || spots.length === 0) {
    const cold = (contributions || []).filter(c => c.activation === 0)
    if (cold.length > 0 && (contributions || []).every(c => c.activation === 0)) {
      return `温度未达${cold.map(c => c.name).join('、')}适用区间，釉面未形成窑变纹理`
    }
    return '釉面熔融不充分，无明显窑变纹理'
  }

  const intensityDesc = intensity < 0.4 ? '轻度' : intensity < 0.7 ? '中度' : '显著'
  const minMm = Math.max(0.5, Math.round(Math.min(...spots.map(s => s.size)) * 1000) / 10)
  const maxMm = Math.max(minMm, Math.round(Math.max(...spots.map(s => s.size)) * 1000) / 10)
  const activeGlazes = (contributions || [])
    .filter(c => c.spotCount > 0)
    .map(c => c.name)
  const glazeText = activeGlazes.length > 0 ? `（${activeGlazes.join('、')}）` : ''

  if (type === 'rabbit') {
    return `${intensityDesc}兔毫纹${glazeText}，共${spots.length}处丝状毫纹，毫径约${minMm}-${maxMm}mm，顺釉层落笔方向延展`
  } else if (type === 'oil') {
    return `${intensityDesc}油滴纹${glazeText}，共${spots.length}枚斑点，直径约${minMm}-${maxMm}mm，斑点疏密随釉层厚度变化`
  } else if (type === 'yohen') {
    return `${intensityDesc}曜变斑${glazeText}，共${spots.length}处色斑，直径约${minMm}-${maxMm}mm，色斑大小随叠加釉层各异`
  }

  return '釉面无明显窑变纹理'
}

export const getTempPointAtTime = (
  history: TempPoint[],
  time: number
): TempPoint | null => {
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].time <= time && history[i + 1].time >= time) {
      return history[i]
    }
  }
  return history[history.length - 1] || null
}
