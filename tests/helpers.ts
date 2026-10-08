import { Vector3 } from 'three'
import { LanternInstance, LanternType } from '../src/types'
import { placeLantern, igniteLantern, advanceLanterns } from '../src/core/lanternCore'

let idSeq = 0

export function nextId(): string {
  idSeq += 1
  return `lamp-${idSeq}`
}

export function place(
  lanterns: LanternInstance[],
  type: LanternType = 'blessing',
  x = 0,
  z = 0,
): { lanterns: LanternInstance[]; lantern: LanternInstance } {
  const result = placeLantern(lanterns, type, new Vector3(x, 3, z), nextId(), 0)
  if (!result) throw new Error('placeLantern 被拒绝（容量已满）')
  return result
}

export function ignite(
  lanterns: LanternInstance[],
  id: string,
  targetHeight: number,
  now: number,
): LanternInstance[] {
  return igniteLantern(lanterns, id, targetHeight, now)
}

export interface StepOptions {
  delta?: number
  start?: number
}

export function step(
  lanterns: LanternInstance[],
  seconds: number,
  { delta = 0.1, start = 0 }: StepOptions = {},
): { lanterns: LanternInstance[]; now: number } {
  let now = start
  let current = lanterns
  const steps = Math.round(seconds / delta)
  for (let i = 0; i < steps; i++) {
    now += delta * 1000
    current = advanceLanterns(current, delta, now).lanterns
  }
  return { lanterns: current, now }
}

export function stepUntil(
  lanterns: LanternInstance[],
  predicate: (lanterns: LanternInstance[]) => boolean,
  { delta = 0.1, start = 0, maxSeconds = 120 }: StepOptions & { maxSeconds?: number } = {},
): { lanterns: LanternInstance[]; now: number; elapsed: number; reached: boolean } {
  let now = start
  let current = lanterns
  let elapsed = 0
  while (elapsed < maxSeconds && !predicate(current)) {
    now += delta * 1000
    elapsed += delta
    current = advanceLanterns(current, delta, now).lanterns
  }
  return { lanterns: current, now, elapsed, reached: predicate(current) }
}

export function byId(lanterns: LanternInstance[], id: string): LanternInstance {
  const found = lanterns.find(l => l.id === id)
  if (!found) throw new Error(`找不到灯 ${id}`)
  return found
}

export const IGNITE_AT = 1_000
