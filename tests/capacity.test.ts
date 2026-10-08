import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { LanternInstance } from '../src/types'
import {
  MAX_ACTIVE_LANTERNS,
  canPlaceLantern,
  countActiveLanterns,
  placeLantern,
} from '../src/core/lanternCore'
import { place, ignite, stepUntil, byId, nextId , IGNITE_AT } from './helpers'

describe('灯库容量上限', () => {
  it('连续放置至 10 盏后，第 11 盏被拒绝且已有灯不受影响', () => {
    let lanterns: LanternInstance[] = []
    for (let i = 0; i < MAX_ACTIVE_LANTERNS; i++) {
      expect(canPlaceLantern(lanterns)).toBe(true)
      lanterns = place(lanterns, 'blessing', i * 0.1, 0).lanterns
    }
    expect(countActiveLanterns(lanterns)).toBe(10)
    expect(canPlaceLantern(lanterns)).toBe(false)

    const snapshot = lanterns.map(l => ({ ...l }))
    const rejected = placeLantern(lanterns, 'peace', new Vector3(0, 3, 0), nextId(), 0)
    expect(rejected).toBeNull()
    expect(lanterns).toHaveLength(10)
    lanterns.forEach((l, i) => {
      expect(l.id).toBe(snapshot[i].id)
      expect(l.state).toBe(snapshot[i].state)
      expect(l.currentHeight).toBe(snapshot[i].currentHeight)
      expect(l.targetHeight).toBe(snapshot[i].targetHeight)
      expect(l.position.toArray()).toEqual(snapshot[i].position.toArray())
    })
  })

  it('容量满时反复尝试放置均失败，且不会挤掉任何已存在的灯', () => {
    let lanterns: LanternInstance[] = []
    for (let i = 0; i < MAX_ACTIVE_LANTERNS; i++) {
      lanterns = place(lanterns, 'message', 0, 0).lanterns
    }
    const idsBefore = lanterns.map(l => l.id)
    for (let i = 0; i < 5; i++) {
      expect(placeLantern(lanterns, 'love', new Vector3(1, 3, 1), nextId(), 0)).toBeNull()
    }
    expect(lanterns.map(l => l.id)).toEqual(idsBefore)
  })

  it('有灯落水后释放容量，可以再次放入新灯', () => {
    let lanterns: LanternInstance[] = []
    for (let i = 0; i < MAX_ACTIVE_LANTERNS; i++) {
      lanterns = place(lanterns, 'blessing', 0, 0).lanterns
    }
    expect(canPlaceLantern(lanterns)).toBe(false)

    const firstId = lanterns[0].id
    lanterns = ignite(lanterns, firstId, 10, IGNITE_AT)
    const fallen = stepUntil(lanterns, ls => byId(ls, firstId).state === 'fallen', { start: IGNITE_AT })
    expect(fallen.reached).toBe(true)
    lanterns = fallen.lanterns

    expect(countActiveLanterns(lanterns)).toBe(9)
    expect(canPlaceLantern(lanterns)).toBe(true)

    const accepted = placeLantern(lanterns, 'peace', new Vector3(0.5, 3, 0.5), nextId(), 0)
    expect(accepted).not.toBeNull()
    expect(accepted!.lanterns).toHaveLength(11)
    expect(countActiveLanterns(accepted!.lanterns)).toBe(10)
    expect(canPlaceLantern(accepted!.lanterns)).toBe(false)
  })
})
