import { describe, it, expect } from 'vitest'
import { createCitiesSnapshot, planMarkerSync } from '../src/utils/citySnapshot'
import type { City } from '../src/types'

function makeCity(id: string, createdAt: number, name = `城市${id}`): City {
  return {
    id,
    name,
    lat: 30 + createdAt,
    lng: 110 + createdAt,
    date: '2026-01-01',
    photo: '',
    description: '',
    createdAt
  }
}

describe('createCitiesSnapshot', () => {
  it('保留排序顺序与字段值', () => {
    const cities = [makeCity('a', 1), makeCity('b', 2), makeCity('c', 3)]
    const snapshot = createCitiesSnapshot(cities)
    expect(snapshot.map(c => c.id)).toEqual(['a', 'b', 'c'])
    expect(snapshot[1].name).toBe('城市b')
    expect(snapshot[1].lat).toBe(32)
  })

  it('快照数组与每个城市对象都被冻结', () => {
    const snapshot = createCitiesSnapshot([makeCity('a', 1)])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot[0])).toBe(true)
  })

  it('快照是深拷贝：修改原数组或原对象不影响快照', () => {
    const cities = [makeCity('a', 1), makeCity('b', 2)]
    const snapshot = createCitiesSnapshot(cities)

    cities.splice(0, 1)
    cities[0].name = '被修改'

    expect(snapshot.length).toBe(2)
    expect(snapshot[0].id).toBe('a')
    expect(snapshot[1].name).toBe('城市b')
  })
})

describe('planMarkerSync', () => {
  it('全新城市全部需要添加', () => {
    const cities = [makeCity('a', 1), makeCity('b', 2)]
    const plan = planMarkerSync([], cities)
    expect(plan.toAdd.map(c => c.id)).toEqual(['a', 'b'])
    expect(plan.toRemove).toEqual([])
  })

  it('删除城市后产生对应的移除项', () => {
    const cities = [makeCity('a', 1), makeCity('c', 3)]
    const plan = planMarkerSync(['a', 'b', 'c'], cities)
    expect(plan.toAdd).toEqual([])
    expect(plan.toRemove).toEqual(['b'])
  })

  it('批量恢复：一次补回多个城市', () => {
    const cities = [makeCity('a', 1), makeCity('b', 2), makeCity('c', 3)]
    const plan = planMarkerSync(['a'], cities)
    expect(plan.toAdd.map(c => c.id)).toEqual(['b', 'c'])
    expect(plan.toRemove).toEqual([])
  })

  it('同一城市重复添加（新 id）只新增缺失项', () => {
    const cities = [makeCity('a', 1), makeCity('a2', 2, '城市a')]
    const plan = planMarkerSync(['a'], cities)
    expect(plan.toAdd.map(c => c.id)).toEqual(['a2'])
    expect(plan.toRemove).toEqual([])
  })

  it('集合不变时不产生任何变更', () => {
    const cities = [makeCity('a', 1), makeCity('b', 2)]
    const plan = planMarkerSync(['a', 'b'], cities)
    expect(plan.toAdd).toEqual([])
    expect(plan.toRemove).toEqual([])
  })

  it('toAdd 顺序与城市集合排序一致', () => {
    const cities = [makeCity('x', 1), makeCity('y', 2), makeCity('z', 3)]
    const plan = planMarkerSync(['y'], cities)
    expect(plan.toAdd.map(c => c.id)).toEqual(['x', 'z'])
  })
})
