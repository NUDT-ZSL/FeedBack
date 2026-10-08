import { describe, it, expect } from 'vitest'
import { LanternInstance } from '../src/types'
import { igniteLantern, isSelectable } from '../src/core/lanternCore'
import { place, ignite, step, byId , IGNITE_AT } from './helpers'

describe('目标高度调控的隔离性', () => {
  it('只有悬停态的灯可以被选中调控', () => {
    let lanterns: LanternInstance[] = []
    const a = place(lanterns, 'blessing')
    lanterns = a.lanterns
    expect(isSelectable(a.lantern)).toBe(true)

    lanterns = ignite(lanterns, a.lantern.id, 5, IGNITE_AT)
    expect(isSelectable(byId(lanterns, a.lantern.id))).toBe(false)
  })

  it('选中一盏灯调整目标高度并点火，其余灯的高度与状态保持不变', () => {
    let lanterns: LanternInstance[] = []
    const a = place(lanterns, 'blessing', -1, 0)
    lanterns = a.lanterns
    const b = place(lanterns, 'message', 1, 0)
    lanterns = b.lanterns
    const c = place(lanterns, 'peace', 0, 1)
    lanterns = c.lanterns

    const adjusted = igniteLantern(lanterns, a.lantern.id, 8, 1_000)
    const lampA = byId(adjusted, a.lantern.id)
    expect(lampA.state).toBe('ignited')
    expect(lampA.targetHeight).toBe(8)

    expect(byId(adjusted, b.lantern.id)).toBe(b.lantern)
    expect(byId(adjusted, c.lantern.id)).toBe(c.lantern)
    expect(byId(adjusted, b.lantern.id).targetHeight).toBe(5)
    expect(byId(adjusted, c.lantern.id).targetHeight).toBe(5)
    expect(byId(adjusted, b.lantern.id).state).toBe('hovering')
    expect(byId(adjusted, c.lantern.id).state).toBe('hovering')
  })

  it('对多盏灯分别设定不同目标高度，升空后各自停在各自的高度', () => {
    let lanterns: LanternInstance[] = []
    const a = place(lanterns, 'blessing', -1, 0)
    lanterns = a.lanterns
    const b = place(lanterns, 'message', 1, 0)
    lanterns = b.lanterns

    lanterns = igniteLantern(lanterns, a.lantern.id, 4, IGNITE_AT)
    lanterns = igniteLantern(lanterns, b.lantern.id, 7, IGNITE_AT)

    const done = step(lanterns, 30, { delta: 0.1, start: IGNITE_AT })
    const lampA = byId(done.lanterns, a.lantern.id)
    const lampB = byId(done.lanterns, b.lantern.id)

    expect(lampA.state).toBe('floating')
    expect(lampA.currentHeight).toBeGreaterThan(3.9)
    expect(lampA.currentHeight).toBeLessThan(4.1)
    expect(lampB.state).toBe('floating')
    expect(lampB.currentHeight).toBeGreaterThan(6.9)
    expect(lampB.currentHeight).toBeLessThan(7.1)
  })
})
