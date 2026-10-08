import { Color, Vector3 } from 'three'
import { LanternInstance, LanternType, LANTERN_CONFIGS, LampData } from '../types'

export const MAX_ACTIVE_LANTERNS = 10
export const DEFAULT_TARGET_HEIGHT = 5
export const MIN_REFLECTION_LANTERNS = 3
export const WATER_LEVEL = 0.5

export interface ReflectionSpot {
  id: string
  position: [number, number, number]
  color: Color
  radius: number
  opacity: number
}

export function countActiveLanterns(lanterns: LanternInstance[]): number {
  return lanterns.filter(l => l.state !== 'fallen').length
}

export function canPlaceLantern(lanterns: LanternInstance[]): boolean {
  return countActiveLanterns(lanterns) < MAX_ACTIVE_LANTERNS
}

export function placeLantern(
  lanterns: LanternInstance[],
  type: LanternType,
  position: Vector3,
  id: string,
  swayOffset: number,
): { lanterns: LanternInstance[]; lantern: LanternInstance } | null {
  if (!canPlaceLantern(lanterns)) return null
  const lantern: LanternInstance = {
    id,
    type,
    position: position.clone(),
    targetHeight: DEFAULT_TARGET_HEIGHT,
    currentHeight: position.y,
    state: 'hovering',
    igniteTime: null,
    fallTime: null,
    glowIntensity: 0.3,
    swayOffset,
  }
  return { lanterns: [...lanterns, lantern], lantern }
}

export function isSelectable(lantern: LanternInstance): boolean {
  return lantern.state === 'hovering'
}

export function igniteLantern(
  lanterns: LanternInstance[],
  id: string,
  targetHeight: number,
  now: number,
): LanternInstance[] {
  return lanterns.map(l =>
    l.id === id && l.state === 'hovering'
      ? { ...l, state: 'ignited' as const, igniteTime: now, targetHeight }
      : l,
  )
}

export function advanceLanterns(
  lanterns: LanternInstance[],
  delta: number,
  now: number,
): { lanterns: LanternInstance[]; changed: boolean } {
  let hasChanges = false
  const updated = lanterns.map(lantern => {
    const config = LANTERN_CONFIGS[lantern.type]
    const l = { ...lantern }

    if (l.state === 'hovering') {
      const flicker = Math.sin(now * 0.005 + l.swayOffset) * 0.1
      l.glowIntensity = 0.3 + flicker
      l.position.y = 3 + Math.sin(now * 0.003 + l.swayOffset) * 0.1
    }

    if (l.state === 'ignited' && l.igniteTime) {
      const elapsed = (now - l.igniteTime) / 1000
      if (elapsed > 0.5) {
        l.state = 'rising'
      }
      l.glowIntensity = Math.min(1, elapsed * 2)
    }

    if (l.state === 'rising') {
      l.currentHeight += 0.5 * delta
      l.position.y = l.currentHeight
      l.glowIntensity = Math.min(1, l.glowIntensity + delta * 0.5)

      if (l.currentHeight >= l.targetHeight) {
        if (l.targetHeight > config.maxHeight) {
          l.state = 'falling'
          l.fallTime = now
        } else {
          l.state = 'floating'
          l.glowIntensity = 1
        }
      }

      if (l.currentHeight > config.maxHeight + 1) {
        l.state = 'falling'
        l.fallTime = now
      }
    }

    if (l.state === 'floating') {
      const sway = Math.sin(now * 0.002 + l.swayOffset) * 0.05
      l.position.x += sway * delta
      l.position.z += Math.cos(now * 0.002 + l.swayOffset) * 0.03 * delta
    }

    if (l.state === 'falling' && l.fallTime) {
      const fallElapsed = (now - l.fallTime) / 1000
      const flicker = Math.sin(now * 0.02) * 0.5 + 0.5
      l.glowIntensity = flicker * (1 - fallElapsed / 2)

      if (fallElapsed > 2) {
        l.currentHeight -= 2 * delta
        l.position.y = l.currentHeight

        if (l.currentHeight <= WATER_LEVEL) {
          l.state = 'fallen'
          l.glowIntensity = 0
        }
      }
    }

    if (
      l.state !== lantern.state ||
      l.currentHeight !== lantern.currentHeight ||
      l.glowIntensity !== lantern.glowIntensity ||
      l.position.x !== lantern.position.x ||
      l.position.z !== lantern.position.z ||
      l.position.y !== lantern.position.y
    ) {
      hasChanges = true
    }

    return l
  })

  return { lanterns: updated, changed: hasChanges }
}

export function countFloatingLamps(lanterns: LanternInstance[]): number {
  return lanterns.filter(l => l.currentHeight > 2 && l.state !== 'fallen').length
}

export function shouldShowReflections(lanterns: LanternInstance[]): boolean {
  return countFloatingLamps(lanterns) >= MIN_REFLECTION_LANTERNS
}

export function computeLampData(lanterns: LanternInstance[]): LampData[] {
  return lanterns
    .filter(l => l.state !== 'fallen' && l.currentHeight > 0)
    .map(l => ({
      id: l.id,
      position: l.position,
      color: new Color(LANTERN_CONFIGS[l.type].color),
      glowRadius: LANTERN_CONFIGS[l.type].glowRadius * l.glowIntensity,
    }))
}

export function computeReflectionSpots(
  lamps: LampData[],
  showReflections: boolean,
): ReflectionSpot[] {
  return lamps
    .filter(l => showReflections && l.position.y > 2)
    .map(l => ({
      id: l.id,
      position: [l.position.x, -l.position.y * 0.3 + 0.05, l.position.z] as [number, number, number],
      color: l.color,
      radius: l.glowRadius * 0.8,
      opacity: (0.15 * l.glowRadius) / 2,
    }))
}
