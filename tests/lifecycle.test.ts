import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { LanternInstance } from '../src/types'
import {
  placeLantern,
  igniteLantern,
  advanceLanterns,
  computeLampData,
} from '../src/core/lanternCore'
import { place, ignite, step, stepUntil, byId , IGNITE_AT } from './helpers'

describe('灯盏完整生命周期', () => {
  it('放置后进入悬停态：位置、高度、闪烁亮度符合预期', () => {
    let lanterns: LanternInstance[] = []
    const result = place(lanterns, 'blessing', 1.5, -0.8)
    lanterns = result.lanterns

    expect(lanterns).toHaveLength(1)
    const lamp = result.lantern
    expect(lamp.state).toBe('hovering')
    expect(lamp.currentHeight).toBe(3)
    expect(lamp.position.x).toBe(1.5)
    expect(lamp.position.z).toBe(-0.8)
    expect(lamp.glowIntensity).toBe(0.3)

    const { lanterns: hovered } = step(lanterns, 1, { delta: 0.1, start: 1000 })
    const hoverLamp = byId(hovered, lamp.id)
    expect(hoverLamp.state).toBe('hovering')
    expect(hoverLamp.position.y).toBeGreaterThanOrEqual(2.9)
    expect(hoverLamp.position.y).toBeLessThanOrEqual(3.1)
    expect(hoverLamp.glowIntensity).toBeGreaterThanOrEqual(0.2)
    expect(hoverLamp.glowIntensity).toBeLessThanOrEqual(0.4)
  })

  it('点火后先短暂点火态，随后匀速升空，达到目标高度后稳定漂浮', () => {
    let lanterns: LanternInstance[] = []
    lanterns = place(lanterns, 'blessing').lanterns
    const id = lanterns[0].id

    const igniteAt = 10_000
    lanterns = ignite(lanterns, id, 5, igniteAt)
    expect(byId(lanterns, id).state).toBe('ignited')

    const beforeRise = step(lanterns, 0.4, { delta: 0.1, start: igniteAt })
    expect(byId(beforeRise.lanterns, id).state).toBe('ignited')

    const afterRise = step(lanterns, 0.6, { delta: 0.1, start: igniteAt })
    expect(byId(afterRise.lanterns, id).state).toBe('rising')

    const floating = stepUntil(lanterns, ls => byId(ls, id).state === 'floating', {
      delta: 0.1,
      start: igniteAt,
    })
    expect(floating.reached).toBe(true)
    expect(floating.elapsed).toBeGreaterThan(4)
    expect(floating.elapsed).toBeLessThan(6)
    const lamp = byId(floating.lanterns, id)
    expect(lamp.currentHeight).toBeGreaterThan(4.9)
    expect(lamp.currentHeight).toBeLessThan(5.1)
    expect(lamp.position.y).toBe(lamp.currentHeight)
    expect(lamp.glowIntensity).toBe(1)

    const stillFloating = step(floating.lanterns, 10, { delta: 0.1, start: floating.now })
    const finalLamp = byId(stillFloating.lanterns, id)
    expect(finalLamp.state).toBe('floating')
    expect(finalLamp.currentHeight).toBe(lamp.currentHeight)
  })

  it('目标高度超过载重上限时，灯经过坠落最终落水', () => {
    let lanterns: LanternInstance[] = []
    lanterns = place(lanterns, 'blessing').lanterns
    const id = lanterns[0].id

    lanterns = ignite(lanterns, id, 10, IGNITE_AT)
    const risingResult = stepUntil(lanterns, ls => byId(ls, id).state === 'falling', {
      delta: 0.1,
      start: IGNITE_AT,
    })
    expect(risingResult.reached).toBe(true)
    const fallingLamp = byId(risingResult.lanterns, id)
    expect(fallingLamp.fallTime).not.toBeNull()
    expect(fallingLamp.currentHeight).toBeGreaterThan(8)

    const beforeDrop = step(risingResult.lanterns, 2, {
      delta: 0.1,
      start: risingResult.now,
    })
    expect(byId(beforeDrop.lanterns, id).state).toBe('falling')
    const heightBeforeDrop = byId(beforeDrop.lanterns, id).currentHeight
    expect(heightBeforeDrop).toBe(fallingLamp.currentHeight)

    const fallenResult = stepUntil(beforeDrop.lanterns, ls => byId(ls, id).state === 'fallen', {
      delta: 0.1,
      start: beforeDrop.now,
    })
    expect(fallenResult.reached).toBe(true)
    const fallenLamp = byId(fallenResult.lanterns, id)
    expect(fallenLamp.currentHeight).toBeLessThanOrEqual(0.5)
    expect(fallenLamp.position.y).toBeLessThanOrEqual(0.5)
    expect(fallenLamp.glowIntensity).toBe(0)
  })

  it('升空过程中反复点火不会重置点火时刻或目标高度，也不产生重复迁移', () => {
    let lanterns: LanternInstance[] = []
    lanterns = place(lanterns, 'blessing').lanterns
    const id = lanterns[0].id

    lanterns = ignite(lanterns, id, 6, 5_000)
    const firstIgnite = byId(lanterns, id)
    expect(firstIgnite.igniteTime).toBe(5_000)

    const rising = step(lanterns, 1, { delta: 0.1, start: 5_000 })
    expect(byId(rising.lanterns, id).state).toBe('rising')

    const reIgnite = igniteLantern(rising.lanterns, id, 2, 99_999)
    const reIgnitedLamp = byId(reIgnite, id)
    expect(reIgnitedLamp.state).toBe('rising')
    expect(reIgnitedLamp.igniteTime).toBe(5_000)
    expect(reIgnitedLamp.targetHeight).toBe(6)

    const reIgniteSame = igniteLantern(reIgnite, id, 9, 123_456)
    expect(byId(reIgniteSame, id)).toEqual(reIgnitedLamp)

    const continued = step(reIgnite, 1, { delta: 0.1, start: rising.now })
    expect(byId(continued.lanterns, id).state).toBe('rising')
    expect(byId(continued.lanterns, id).currentHeight).toBeCloseTo(
      byId(rising.lanterns, id).currentHeight + 0.5,
      5,
    )
  })

  it('对坠落中、落水后的灯再次点火不会产生任何迁移', () => {
    let lanterns: LanternInstance[] = []
    lanterns = place(lanterns, 'blessing').lanterns
    const id = lanterns[0].id

    lanterns = ignite(lanterns, id, 10, IGNITE_AT)
    const fallingResult = stepUntil(lanterns, ls => byId(ls, id).state === 'falling', {
      start: IGNITE_AT,
    })
    const duringFall = igniteLantern(fallingResult.lanterns, id, 3, 88_888)
    expect(byId(duringFall, id)).toBe(byId(fallingResult.lanterns, id))

    const fallenResult = stepUntil(duringFall, ls => byId(ls, id).state === 'fallen', {
      start: fallingResult.now,
    })
    const afterFallen = igniteLantern(fallenResult.lanterns, id, 3, 99_999)
    expect(byId(afterFallen, id)).toBe(byId(fallenResult.lanterns, id))
  })

  it('落水后的灯不再参与后续帧更新、灯光数据与倒影计算', () => {
    let lanterns: LanternInstance[] = []
    lanterns = place(lanterns, 'blessing').lanterns
    const id = lanterns[0].id

    lanterns = ignite(lanterns, id, 10, IGNITE_AT)
    const fallenResult = stepUntil(lanterns, ls => byId(ls, id).state === 'fallen', {
      start: IGNITE_AT,
    })
    expect(fallenResult.reached).toBe(true)
    const frozen = byId(fallenResult.lanterns, id)

    const later = advanceLanterns(fallenResult.lanterns, 5, fallenResult.now + 30_000)
    const frozenAfter = byId(later.lanterns, id)
    expect(frozenAfter.state).toBe('fallen')
    expect(frozenAfter.currentHeight).toBe(frozen.currentHeight)
    expect(frozenAfter.position.y).toBe(frozen.position.y)
    expect(frozenAfter.glowIntensity).toBe(0)
    expect(later.changed).toBe(false)

    expect(computeLampData(later.lanterns).map(l => l.id)).not.toContain(id)
  })
})

describe('放置输入的基本约束', () => {
  it('放入的位置使用克隆坐标，后续坐标变更不影响已放置的灯', () => {
    const origin = new Vector3(2, 3, -1)
    const result = placeLantern([], 'blessing', origin, 'clone-lamp', 0)
    expect(result).not.toBeNull()
    origin.set(100, 100, 100)
    expect(result!.lantern.position.toArray()).toEqual([2, 3, -1])
  })
})
