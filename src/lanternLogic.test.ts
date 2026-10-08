import { describe, it, expect } from 'vitest'
import { Vector3, Color } from 'three'
import { LanternInstance, LANTERN_CONFIGS } from './types'
import {
  MAX_ACTIVE_LANTERNS,
  createLantern,
  tryPlaceLantern,
  canPlaceLantern,
  countActiveLanterns,
  canSelectLantern,
  igniteLantern,
  setLanternTargetHeight,
  triggerFall,
  stepAllLanterns,
  computeWaterLamps,
  reflectionsVisible,
  computeReflections,
} from './lanternLogic'

const DELTA = 1 / 60

function runFrames(lanterns: LanternInstance[], seconds: number, startNow: number) {
  let now = startNow
  let current = lanterns
  const frames = Math.ceil(seconds / DELTA)
  for (let i = 0; i < frames; i++) {
    now += DELTA * 1000
    current = stepAllLanterns(current, DELTA, now).lanterns
  }
  return { lanterns: current, now }
}

function placeOne(id: string, type: Parameters<typeof createLantern>[0] = 'blessing') {
  return tryPlaceLantern([], type, new Vector3(1, 3, -1), { id, swayOffset: 0 })
}

describe('放灯与容量上限', () => {
  it('放灯后进入悬停状态，初始高度与落点一致', () => {
    const lanterns = placeOne('l1')
    expect(lanterns).toHaveLength(1)
    expect(lanterns[0].state).toBe('hovering')
    expect(lanterns[0].currentHeight).toBe(3)
    expect(lanterns[0].targetHeight).toBe(5)
    expect(canSelectLantern(lanterns[0])).toBe(true)
  })

  it('连续放满 10 盏后新增灯被拒绝，已有灯不受影响', () => {
    let lanterns: LanternInstance[] = []
    for (let i = 0; i < MAX_ACTIVE_LANTERNS + 3; i++) {
      lanterns = tryPlaceLantern(lanterns, 'message', new Vector3(0, 3, 0), {
        id: `l${i}`,
        swayOffset: 0,
      })
    }
    expect(lanterns).toHaveLength(MAX_ACTIVE_LANTERNS)
    expect(canPlaceLantern(lanterns)).toBe(false)

    const before = lanterns
    const after = tryPlaceLantern(lanterns, 'love', new Vector3(1, 3, 1), { id: 'extra' })
    expect(after).toBe(before)
    expect(after).toHaveLength(MAX_ACTIVE_LANTERNS)
    expect(after.some(l => l.id === 'extra')).toBe(false)
    after.forEach((l, i) => expect(l).toBe(before[i]))
  })

  it('落水的灯释放容量，可继续放新灯', () => {
    let lanterns: LanternInstance[] = []
    for (let i = 0; i < MAX_ACTIVE_LANTERNS; i++) {
      lanterns = tryPlaceLantern(lanterns, 'message', new Vector3(0, 3, 0), {
        id: `l${i}`,
        swayOffset: 0,
      })
    }
    lanterns = lanterns.map((l, i) => (i === 0 ? { ...l, state: 'fallen' as const } : l))
    expect(canPlaceLantern(lanterns)).toBe(true)

    lanterns = tryPlaceLantern(lanterns, 'peace', new Vector3(0, 3, 0), { id: 'new' })
    expect(lanterns).toHaveLength(MAX_ACTIVE_LANTERNS + 1)
    expect(countActiveLanterns(lanterns)).toBe(MAX_ACTIVE_LANTERNS)
  })
})

describe('点火升空正常路径', () => {
  it('悬停 → 点火 → 升空 → 到达目标高度后悬浮', () => {
    let lanterns = placeOne('l1')
    lanterns = igniteLantern(lanterns, 'l1', 6, 1000)
    expect(lanterns[0].state).toBe('ignited')
    expect(lanterns[0].igniteTime).toBe(1000)
    expect(lanterns[0].targetHeight).toBe(6)

    let result = runFrames(lanterns, 0.4, 1000)
    expect(result.lanterns[0].state).toBe('ignited')

    result = runFrames(result.lanterns, 0.2, result.now)
    expect(result.lanterns[0].state).toBe('rising')

    result = runFrames(result.lanterns, 30, result.now)
    const done = result.lanterns[0]
    expect(done.state).toBe('floating')
    expect(Math.abs(done.currentHeight - 6)).toBeLessThan(0.01)
    expect(done.position.y).toBeCloseTo(done.currentHeight)
    expect(done.glowIntensity).toBe(1)
  })

  it('目标高度超过载重上限时灯坠落入水', () => {
    let lanterns = placeOne('l1')
    lanterns = igniteLantern(lanterns, 'l1', 10, 1000)

    let now = 1000
    for (let i = 0; i < 60 * 60 && lanterns[0].state !== 'falling'; i++) {
      now += DELTA * 1000
      lanterns = stepAllLanterns(lanterns, DELTA, now).lanterns
    }
    const falling = lanterns[0]
    expect(falling.state).toBe('falling')
    expect(falling.fallTime).not.toBeNull()
    const heightAtFall = falling.currentHeight

    let result = runFrames(lanterns, 1, now)
    expect(result.lanterns[0].state).toBe('falling')
    expect(result.lanterns[0].currentHeight).toBe(heightAtFall)

    result = runFrames(result.lanterns, 30, result.now)
    const fallen = result.lanterns[0]
    expect(fallen.state).toBe('fallen')
    expect(fallen.currentHeight).toBeLessThanOrEqual(0.5)
    expect(fallen.glowIntensity).toBe(0)
  })
})

describe('状态迁移幂等', () => {
  it('升空过程中反复点火不产生重复状态迁移', () => {
    let lanterns = placeOne('l1')
    lanterns = igniteLantern(lanterns, 'l1', 6, 1000)

    const ignitedAgain = igniteLantern(lanterns, 'l1', 9, 2000)
    expect(ignitedAgain[0]).toBe(lanterns[0])

    const risen = runFrames(lanterns, 2, 1000)
    const rising = risen.lanterns[0]
    expect(rising.state).toBe('rising')

    const again = igniteLantern(risen.lanterns, 'l1', 9, 5000)
    expect(again[0]).toBe(rising)
    expect(again[0].state).toBe('rising')
    expect(again[0].targetHeight).toBe(6)
    expect(again[0].igniteTime).toBe(1000)

    const floated = runFrames(risen.lanterns, 30, risen.now)
    expect(floated.lanterns[0].state).toBe('floating')
    const afterFloat = igniteLantern(floated.lanterns, 'l1', 9, 9000)
    expect(afterFloat[0]).toBe(floated.lanterns[0])
  })

  it('坠落与落水后反复触发落水不重置坠落时刻、不改变终态', () => {
    let lanterns = placeOne('l1')
    lanterns = igniteLantern(lanterns, 'l1', 6, 1000)
    const risen = runFrames(lanterns, 2, 1000)
    expect(risen.lanterns[0].state).toBe('rising')

    lanterns = triggerFall(risen.lanterns, 'l1', 2000)
    expect(lanterns[0].state).toBe('falling')
    expect(lanterns[0].fallTime).toBe(2000)

    lanterns = triggerFall(lanterns, 'l1', 3000)
    expect(lanterns[0].fallTime).toBe(2000)

    const stepped = runFrames(lanterns, 0.5, 3000)
    const again = triggerFall(stepped.lanterns, 'l1', stepped.now)
    expect(again[0].fallTime).toBe(2000)

    const finished = runFrames(stepped.lanterns, 30, stepped.now)
    expect(finished.lanterns[0].state).toBe('fallen')
    const afterFallen = triggerFall(finished.lanterns, 'l1', finished.now)
    expect(afterFallen[0]).toBe(finished.lanterns[0])
    expect(afterFallen[0].state).toBe('fallen')
  })

  it('非悬停状态的灯不可被选中点火', () => {
    const base = createLantern('blessing', new Vector3(0, 3, 0), { id: 'l1', swayOffset: 0 })
    const states: LanternInstance['state'][] = ['ignited', 'rising', 'floating', 'falling', 'fallen']
    for (const state of states) {
      expect(canSelectLantern({ ...base, state })).toBe(false)
    }
    expect(canSelectLantern(base)).toBe(true)
  })
})

describe('目标高度调整隔离', () => {
  function placeThree() {
    let lanterns: LanternInstance[] = []
    for (const id of ['a', 'b', 'c']) {
      lanterns = tryPlaceLantern(lanterns, 'blessing', new Vector3(0, 3, 0), { id, swayOffset: 0 })
    }
    return lanterns
  }

  it('调整选中灯的目标高度只影响该灯', () => {
    const lanterns = placeThree()
    const updated = setLanternTargetHeight(lanterns, 'b', 8)
    expect(updated[1].targetHeight).toBe(8)
    expect(updated[0]).toBe(lanterns[0])
    expect(updated[2]).toBe(lanterns[2])
    expect(updated[0].targetHeight).toBe(5)
    expect(updated[2].targetHeight).toBe(5)
  })

  it('目标高度钳制在 0-10 滑块范围内', () => {
    const lanterns = placeThree()
    expect(setLanternTargetHeight(lanterns, 'a', 99)[0].targetHeight).toBe(10)
    expect(setLanternTargetHeight(lanterns, 'a', -3)[0].targetHeight).toBe(0)
  })

  it('点火只把高度应用到选中的灯，其余灯高度与状态保持不变', () => {
    let lanterns = placeThree()
    lanterns = igniteLantern(lanterns, 'b', 8, 1000)
    expect(lanterns[1].state).toBe('ignited')
    expect(lanterns[1].targetHeight).toBe(8)
    expect(lanterns[0].state).toBe('hovering')
    expect(lanterns[0].targetHeight).toBe(5)
    expect(lanterns[2].state).toBe('hovering')
    expect(lanterns[2].targetHeight).toBe(5)

    const result = runFrames(lanterns, 5, 1000)
    expect(result.lanterns[1].state).toBe('rising')
    expect(result.lanterns[0].state).toBe('hovering')
    expect(result.lanterns[0].currentHeight).toBe(3)
    expect(result.lanterns[2].state).toBe('hovering')
    expect(result.lanterns[2].currentHeight).toBe(3)
  })
})

describe('水面倒影与灯光联动', () => {
  function floatingLanterns(count: number, startNow = 1000) {
    let lanterns: LanternInstance[] = []
    for (let i = 0; i < count; i++) {
      lanterns = tryPlaceLantern(lanterns, 'blessing', new Vector3(i, 3, -i), {
        id: `l${i}`,
        swayOffset: 0,
      })
      lanterns = igniteLantern(lanterns, `l${i}`, 6, startNow)
    }
    return runFrames(lanterns, 30, startNow)
  }

  it('高空灯不足 3 盏时倒影关闭，达到 3 盏后开启', () => {
    const two = floatingLanterns(2)
    expect(two.lanterns.every(l => l.state === 'floating')).toBe(true)
    expect(reflectionsVisible(two.lanterns)).toBe(false)

    const three = floatingLanterns(3)
    expect(reflectionsVisible(three.lanterns)).toBe(true)
  })

  it('水面灯光数据与灯的位置、颜色、光晕一一对应', () => {
    const { lanterns } = floatingLanterns(3)
    const lamps = computeWaterLamps(lanterns)
    expect(lamps.map(l => l.id).sort()).toEqual(['l0', 'l1', 'l2'])
    for (const lamp of lamps) {
      const lantern = lanterns.find(l => l.id === lamp.id)!
      const config = LANTERN_CONFIGS[lantern.type]
      expect(lamp.position).toBe(lantern.position)
      expect(lamp.color.getHexString()).toBe(new Color(config.color).getHexString())
      expect(lamp.glowRadius).toBeCloseTo(config.glowRadius * lantern.glowIntensity)
    }
  })

  it('倒影开关切换后镜像与灯光的位置、颜色对应关系仍成立', () => {
    const { lanterns } = floatingLanterns(3)
    const lamps = computeWaterLamps(lanterns)

    expect(computeReflections(lamps, false)).toEqual([])

    const reflections = computeReflections(lamps, true)
    expect(reflections).toHaveLength(3)
    for (const reflection of reflections) {
      const lamp = lamps.find(l => l.id === reflection.id)!
      expect(reflection.position.x).toBe(lamp.position.x)
      expect(reflection.position.z).toBe(lamp.position.z)
      expect(reflection.position.y).toBeCloseTo(-lamp.position.y * 0.3 + 0.05)
      expect(reflection.color).toBe(lamp.color)
      expect(reflection.opacity).toBeCloseTo(0.15 * lamp.glowRadius / 2)
    }
  })

  it('高度不超过 2 的灯不产生倒影镜像', () => {
    const lowLamp = {
      id: 'low',
      position: new Vector3(0, 1, 0),
      color: new Color('#ffffff'),
      glowRadius: 1,
    }
    const { lanterns } = floatingLanterns(3)
    const lamps = [...computeWaterLamps(lanterns), lowLamp]
    const reflections = computeReflections(lamps, true)
    expect(reflections).toHaveLength(3)
    expect(reflections.some(r => r.id === 'low')).toBe(false)
  })
})

describe('落水后退出后续计算', () => {
  it('落水的灯不再升空、不再参与水面灯光与倒影计算', () => {
    let lanterns: LanternInstance[] = []
    for (const [id, target] of [['a', 6], ['b', 6], ['c', 10]] as const) {
      lanterns = tryPlaceLantern(lanterns, 'blessing', new Vector3(0, 3, 0), { id, swayOffset: 0 })
      lanterns = igniteLantern(lanterns, id, target, 1000)
    }

    let result = runFrames(lanterns, 60, 1000)
    const fallen = result.lanterns.find(l => l.id === 'c')!
    expect(fallen.state).toBe('fallen')
    expect(result.lanterns.find(l => l.id === 'a')!.state).toBe('floating')
    expect(result.lanterns.find(l => l.id === 'b')!.state).toBe('floating')

    const stepped = stepAllLanterns(result.lanterns, DELTA, result.now + DELTA * 1000)
    const stillFallen = stepped.lanterns.find(l => l.id === 'c')!
    expect(stillFallen.state).toBe('fallen')
    expect(stillFallen.currentHeight).toBe(fallen.currentHeight)
    expect(stillFallen.glowIntensity).toBe(0)

    const lamps = computeWaterLamps(stepped.lanterns)
    expect(lamps.map(l => l.id).sort()).toEqual(['a', 'b'])

    expect(reflectionsVisible(stepped.lanterns)).toBe(false)
    expect(computeReflections(lamps, reflectionsVisible(stepped.lanterns))).toEqual([])
  })
})
