import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { LanternInstance, LANTERN_CONFIGS } from '../src/types'
import {
  computeLampData,
  computeReflectionSpots,
  countFloatingLamps,
  shouldShowReflections,
} from '../src/core/lanternCore'
import { place, ignite, step, stepUntil, byId , IGNITE_AT } from './helpers'

function riseToFloating(lanterns: LanternInstance[], ids: string[], target = 5) {
  let current = lanterns
  for (const id of ids) {
    current = ignite(current, id, target, IGNITE_AT)
  }
  return step(current, 30, { delta: 0.1, start: IGNITE_AT }).lanterns
}

describe('水面倒影与灯光联动', () => {
  it('少于 3 盏高空灯时倒影关闭，达到 3 盏后自动开启', () => {
    let lanterns: LanternInstance[] = []
    const a = place(lanterns, 'blessing', -2, 0)
    lanterns = a.lanterns
    const b = place(lanterns, 'message', 0, 0)
    lanterns = b.lanterns

    let risen = riseToFloating(lanterns, [a.lantern.id, b.lantern.id])
    expect(countFloatingLamps(risen)).toBe(2)
    expect(shouldShowReflections(risen)).toBe(false)
    expect(computeReflectionSpots(computeLampData(risen), false)).toHaveLength(0)

    const c = place(risen, 'celebration', 2, 0)
    risen = riseToFloating(c.lanterns, [c.lantern.id])
    expect(countFloatingLamps(risen)).toBe(3)
    expect(shouldShowReflections(risen)).toBe(true)
    expect(computeReflectionSpots(computeLampData(risen), true)).toHaveLength(3)
  })

  it('倒影开启时，每个倒影的位置、颜色、半径与对应灯严格一致', () => {
    let lanterns: LanternInstance[] = []
    const placed = [
      place(lanterns, 'blessing', -2, -1),
    ]
    lanterns = placed[0].lanterns
    placed.push(place(lanterns, 'love', 0, 1))
    lanterns = placed[1].lanterns
    placed.push(place(lanterns, 'peace', 2, 0))
    lanterns = placed[2].lanterns

    const risen = riseToFloating(lanterns, placed.map(p => p.lantern.id))
    const lamps = computeLampData(risen)
    const spots = computeReflectionSpots(lamps, true)

    expect(spots).toHaveLength(3)
    for (const p of placed) {
      const lamp = lamps.find(l => l.id === p.lantern.id)!
      const spot = spots.find(s => s.id === p.lantern.id)!
      const config = LANTERN_CONFIGS[p.lantern.type]

      expect(spot.position[0]).toBeCloseTo(lamp.position.x, 10)
      expect(spot.position[1]).toBeCloseTo(-lamp.position.y * 0.3 + 0.05, 10)
      expect(spot.position[2]).toBeCloseTo(lamp.position.z, 10)
      expect(spot.position[1]).toBeLessThan(0)

      const expected = new Color(config.color)
      expect(spot.color.r).toBeCloseTo(expected.r, 10)
      expect(spot.color.g).toBeCloseTo(expected.g, 10)
      expect(spot.color.b).toBeCloseTo(expected.b, 10)

      expect(spot.radius).toBeCloseTo(config.glowRadius * 0.8, 10)
      expect(spot.opacity).toBeCloseTo((0.15 * config.glowRadius) / 2, 10)
    }
  })

  it('倒影开关切换只控制倒影显隐，灯光数据本身的位置与颜色对应关系不变', () => {
    let lanterns: LanternInstance[] = []
    const a = place(lanterns, 'blessing', -2, 0)
    lanterns = a.lanterns
    const b = place(lanterns, 'message', 0, 0)
    lanterns = b.lanterns
    const c = place(lanterns, 'celebration', 2, 0)
    lanterns = c.lanterns

    const risen = riseToFloating(lanterns, [a.lantern.id, b.lantern.id, c.lantern.id])
    const lamps = computeLampData(risen)

    const spotsOn = computeReflectionSpots(lamps, true)
    const spotsOff = computeReflectionSpots(lamps, false)
    expect(spotsOn).toHaveLength(3)
    expect(spotsOff).toHaveLength(0)

    const lampsAfterToggle = computeLampData(risen)
    expect(lampsAfterToggle.map(l => l.id)).toEqual(lamps.map(l => l.id))
    lampsAfterToggle.forEach((l, i) => {
      expect(l.color.getHex()).toBe(lamps[i].color.getHex())
      expect(l.position).toBe(lamps[i].position)
      expect(l.glowRadius).toBe(lamps[i].glowRadius)
    })

    const spotsOnAgain = computeReflectionSpots(lampsAfterToggle, true)
    expect(spotsOnAgain.map(s => s.id)).toEqual(spotsOn.map(s => s.id))
    spotsOnAgain.forEach((s, i) => {
      expect(s.position).toEqual(spotsOn[i].position)
      expect(s.color.getHex()).toBe(spotsOn[i].color.getHex())
    })
  })

  it('灯落水后退出倒影与高空灯计数，剩余灯不足 3 盏时倒影整体关闭', () => {
    let lanterns: LanternInstance[] = []
    const a = place(lanterns, 'blessing', -2, 0)
    lanterns = a.lanterns
    const b = place(lanterns, 'message', 0, 0)
    lanterns = b.lanterns
    const c = place(lanterns, 'celebration', 2, 0)
    lanterns = c.lanterns

    let current = ignite(lanterns, b.lantern.id, 5, IGNITE_AT)
    current = ignite(current, c.lantern.id, 5, IGNITE_AT)
    current = ignite(current, a.lantern.id, 10, IGNITE_AT)

    const fallen = stepUntil(current, ls => byId(ls, a.lantern.id).state === 'fallen', { start: IGNITE_AT })
    expect(fallen.reached).toBe(true)
    expect(byId(fallen.lanterns, b.lantern.id).state).toBe('floating')
    expect(byId(fallen.lanterns, c.lantern.id).state).toBe('floating')

    const lampData = computeLampData(fallen.lanterns)
    expect(lampData.map(l => l.id)).not.toContain(a.lantern.id)
    expect(lampData.map(l => l.id)).toEqual([b.lantern.id, c.lantern.id])

    expect(countFloatingLamps(fallen.lanterns)).toBe(2)
    expect(shouldShowReflections(fallen.lanterns)).toBe(false)
    expect(computeReflectionSpots(lampData, false)).toHaveLength(0)
  })

  it('坠落中高度降至 2 以下的灯不产生倒影，但仍计入灯光数据', () => {
    let lanterns: LanternInstance[] = []
    const a = place(lanterns, 'blessing', -2, 0)
    lanterns = a.lanterns
    const b = place(lanterns, 'message', 0, 0)
    lanterns = b.lanterns
    const c = place(lanterns, 'celebration', 2, 0)
    lanterns = c.lanterns
    const d = place(lanterns, 'peace', 1, 1)
    lanterns = d.lanterns

    let current = ignite(lanterns, b.lantern.id, 5, IGNITE_AT)
    current = ignite(current, c.lantern.id, 5, IGNITE_AT)
    current = ignite(current, d.lantern.id, 5, IGNITE_AT)
    current = ignite(current, a.lantern.id, 10, IGNITE_AT)

    const lowFalling = stepUntil(
      current,
      ls => byId(ls, a.lantern.id).state === 'falling' && byId(ls, a.lantern.id).currentHeight < 2,
      { start: IGNITE_AT },
    )
    expect(lowFalling.reached).toBe(true)
    const lampA = byId(lowFalling.lanterns, a.lantern.id)
    expect(lampA.state).toBe('falling')
    expect(lampA.position.y).toBeLessThan(2)

    const lamps = computeLampData(lowFalling.lanterns)
    expect(lamps.map(l => l.id)).toContain(a.lantern.id)
    expect(shouldShowReflections(lowFalling.lanterns)).toBe(true)

    const spots = computeReflectionSpots(lamps, true)
    expect(spots.map(s => s.id)).toEqual([b.lantern.id, c.lantern.id, d.lantern.id])
  })
})
