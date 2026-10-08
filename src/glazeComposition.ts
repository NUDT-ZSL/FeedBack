import { GlazeStroke, GlazeType } from './store'

export const COMPOSITION_GRID_SIZE = 48

export interface GlazeLayer {
  glazeId: string
  order: number
  thickness: number
}

export interface CompositionCell {
  u: number
  v: number
  layers: GlazeLayer[]
  totalThickness: number
}

export interface GlazeComposition {
  gridSize: number
  cells: CompositionCell[]
  totalThickness: number
  glazeCoverage: Record<string, number>
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000

export const buildGlazeComposition = (
  strokes: GlazeStroke[],
  glazes: GlazeType[],
  gridSize: number = COMPOSITION_GRID_SIZE
): GlazeComposition => {
  const cellCount = gridSize * gridSize
  const layerMap: Map<string, GlazeLayer>[] = new Array(cellCount)
  for (let i = 0; i < cellCount; i++) {
    layerMap[i] = new Map<string, GlazeLayer>()
  }

  const glazeById = new Map(glazes.map(g => [g.id, g]))
  const cellSize = 1 / gridSize

  strokes.forEach((stroke, order) => {
    const glaze = glazeById.get(stroke.glazeId)
    if (!glaze || stroke.uvCoords.length === 0 || stroke.thickness <= 0) return

    const brushRadius = 0.02 + stroke.thickness * 0.06
    const step = Math.max(cellSize * 0.5, brushRadius * 0.5)
    const deposit = stroke.thickness * 0.5

    const stampAt = (u: number, v: number) => {
      const minCx = Math.max(0, Math.floor((u - brushRadius) / cellSize))
      const maxCx = Math.min(gridSize - 1, Math.floor((u + brushRadius) / cellSize))
      const minCy = Math.max(0, Math.floor((v - brushRadius) / cellSize))
      const maxCy = Math.min(gridSize - 1, Math.floor((v + brushRadius) / cellSize))

      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const cu = (cx + 0.5) * cellSize
          const cv = (cy + 0.5) * cellSize
          const dist = Math.hypot(cu - u, cv - v)
          if (dist > brushRadius) continue

          const falloff = 1 - dist / brushRadius
          const idx = cy * gridSize + cx
          const cellLayers = layerMap[idx]
          const existing = cellLayers.get(stroke.glazeId)

          if (existing) {
            existing.thickness = round4(existing.thickness + deposit * falloff)
          } else {
            cellLayers.set(stroke.glazeId, {
              glazeId: stroke.glazeId,
              order,
              thickness: round4(deposit * falloff),
            })
          }
        }
      }
    }

    let prev = stroke.uvCoords[0]
    stampAt(prev[0], prev[1])
    for (let i = 1; i < stroke.uvCoords.length; i++) {
      const curr = stroke.uvCoords[i]
      const dist = Math.hypot(curr[0] - prev[0], curr[1] - prev[1])
      const steps = Math.max(1, Math.ceil(dist / step))
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        stampAt(prev[0] + (curr[0] - prev[0]) * t, prev[1] + (curr[1] - prev[1]) * t)
      }
      prev = curr
    }
  })

  const cells: CompositionCell[] = []
  const glazeCoverage: Record<string, number> = {}
  let totalThickness = 0

  for (let cy = 0; cy < gridSize; cy++) {
    for (let cx = 0; cx < gridSize; cx++) {
      const layers = Array.from(layerMap[cy * gridSize + cx].values())
        .filter(l => l.thickness > 0)
        .sort((a, b) => a.order - b.order)
      if (layers.length === 0) continue

      const cellThickness = round4(layers.reduce((sum, l) => sum + l.thickness, 0))
      totalThickness = round4(totalThickness + cellThickness)

      cells.push({
        u: round4((cx + 0.5) * cellSize),
        v: round4((cy + 0.5) * cellSize),
        layers,
        totalThickness: cellThickness,
      })

      layers.forEach(layer => {
        glazeCoverage[layer.glazeId] = (glazeCoverage[layer.glazeId] || 0) + 1
      })
    }
  }

  Object.keys(glazeCoverage).forEach(id => {
    glazeCoverage[id] = round4(glazeCoverage[id] / cellCount)
  })

  return { gridSize, cells, totalThickness, glazeCoverage }
}

export const fnv1aHash = (input: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export const hashStrokes = (strokes: GlazeStroke[]): number => {
  const canonical = strokes.map(s => ({
    glazeId: s.glazeId,
    thickness: round4(s.thickness),
    uv: s.uvCoords.map(([u, v]) => [round4(u), round4(v)]),
  }))
  return fnv1aHash(JSON.stringify(canonical))
}
