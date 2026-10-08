import { Color, Vector3 } from 'three'
import { v4 as uuidv4 } from 'uuid'
import { LanternInstance, LanternType, LANTERN_CONFIGS } from './types'

export const MAX_ACTIVE_LANTERNS = 10
export const MIN_TARGET_HEIGHT = 0
export const MAX_TARGET_HEIGHT = 10
export const REFLECTION_MIN_LAMPS = 3
export const REFLECTION_MIN_HEIGHT = 2
export const WATER_LAMP_MIN_HEIGHT = 0

export interface WaterLamp {
  id: string
  position: Vector3
  color: Color
  glowRadius: number
}

export interface WaterReflection {
  id: string
  position: Vector3
  color: Color
  glowRadius: number
  opacity: number
}

export function countActiveLanterns(lanterns: LanternInstance[]): number {
  return lanterns.filter(l => l.state !== 'fallen').length
}

export function canPlaceLantern(lanterns: LanternInstance[]): boolean {
  return countActiveLanterns(lanterns) < MAX_ACTIVE_LANTERNS
}

export function createLantern(
  type: LanternType,
  position: Vector3,
  options: { id?: string; swayOffset?: number } = {},
): LanternInstance {
  return {
    id: options.id ?? uuidv4(),
    type,
    position: position.clone(),
    targetHeight: 5,
    currentHeight: position.y,
    state: 'hovering',
    igniteTime: null,
    fallTime: null,
    glowIntensity: 0.3,
    swayOffset: options.swayOffset ?? Math.random() * Math.PI * 2,
  }
}

export function tryPlaceLantern(
  lanterns: LanternInstance[],
  type: LanternType,
  position: Vector3,
  options: { id?: string; swayOffset?: number } = {},
): LanternInstance[] {
  if (!canPlaceLantern(lanterns)) {
    return lanterns
  }
  return [...lanterns, createLantern(type, position, options)]
}

export function canSelectLantern(lantern: LanternInstance): boolean {
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

export function setLanternTargetHeight(
  lanterns: LanternInstance[],
  id: string,
  targetHeight: number,
): LanternInstance[] {
  const clamped = Math.max(MIN_TARGET_HEIGHT, Math.min(MAX_TARGET_HEIGHT, targetHeight))
  return lanterns.map(l => (l.id === id ? { ...l, targetHeight: clamped } : l))
}

export function triggerFall(lanterns: LanternInstance[], id: string, now: number): LanternInstance[] {
  return lanterns.map(l =>
    l.id === id && l.state !== 'falling' && l.state !== 'fallen'
      ? { ...l, state: 'falling' as const, fallTime: now }
      : l,
  )
}

export function stepLantern(lantern: LanternInstance, delta: number, now: number): LanternInstance {
  const config = LANTERN_CONFIGS[lantern.type]
  const l: LanternInstance = { ...lantern, position: lantern.position.clone() }

  if (l.state === 'hovering') {
    const flicker = Math.sin(now * 0.005 + l.swayOffset) * 0.1
    l.glowIntensity = 0.3 + flicker
    l.position.y = 3 + Math.sin(now * 0.003 + l.swayOffset) * 0.1
  }

  if (l.state === 'ignited' && l.igniteTime !== null) {
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

  if (l.state === 'falling' && l.fallTime !== null) {
    const fallElapsed = (now - l.fallTime) / 1000
    const flicker = Math.sin(now * 0.02) * 0.5 + 0.5
    l.glowIntensity = flicker * (1 - fallElapsed / 2)

    if (fallElapsed > 2) {
      l.currentHeight -= 2 * delta
      l.position.y = l.currentHeight

      if (l.currentHeight <= 0.5) {
        l.state = 'fallen'
        l.glowIntensity = 0
      }
    }
  }

  return l
}

export function stepAllLanterns(
  lanterns: LanternInstance[],
  delta: number,
  now: number,
): { lanterns: LanternInstance[]; changed: boolean } {
  let changed = false
  const updated = lanterns.map(lantern => {
    const l = stepLantern(lantern, delta, now)
    if (
      l.state !== lantern.state ||
      l.currentHeight !== lantern.currentHeight ||
      l.glowIntensity !== lantern.glowIntensity ||
      l.position.x !== lantern.position.x ||
      l.position.z !== lantern.position.z ||
      l.position.y !== lantern.position.y
    ) {
      changed = true
    }
    return l
  })
  return { lanterns: updated, changed }
}

export function computeWaterLamps(lanterns: LanternInstance[]): WaterLamp[] {
  return lanterns
    .filter(l => l.state !== 'fallen' && l.currentHeight > WATER_LAMP_MIN_HEIGHT)
    .map(l => ({
      id: l.id,
      position: l.position,
      color: new Color(LANTERN_CONFIGS[l.type].color),
      glowRadius: LANTERN_CONFIGS[l.type].glowRadius * l.glowIntensity,
    }))
}

export function reflectionsVisible(lanterns: LanternInstance[]): boolean {
  const floatingLampCount = lanterns.filter(
    l => l.currentHeight > REFLECTION_MIN_HEIGHT && l.state !== 'fallen',
  ).length
  return floatingLampCount >= REFLECTION_MIN_LAMPS
}

export function computeReflections(lamps: WaterLamp[], showReflections: boolean): WaterReflection[] {
  if (!showReflections) {
    return []
  }
  return lamps
    .filter(lamp => lamp.position.y > REFLECTION_MIN_HEIGHT)
    .map(lamp => ({
      id: lamp.id,
      position: new Vector3(lamp.position.x, -lamp.position.y * 0.3 + 0.05, lamp.position.z),
      color: lamp.color,
      glowRadius: lamp.glowRadius,
      opacity: 0.15 * lamp.glowRadius / 2,
    }))
}
