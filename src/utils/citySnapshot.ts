import type { City } from '../types'

/**
 * 创建一份与当前排序一致的不可变城市快照。
 * 快照数组与每个城市对象都被冻结，导出会话期间
 * store 中的增删改都不会影响这份快照。
 */
export function createCitiesSnapshot(cities: readonly City[]): ReadonlyArray<City> {
  const snapshot = cities.map(city => Object.freeze({ ...city }))
  return Object.freeze(snapshot) as ReadonlyArray<City>
}

export interface MarkerSyncPlan {
  /** 当前集合中存在、但地图上还没有标记的城市（按排序顺序） */
  toAdd: City[]
  /** 地图上有标记、但已不在当前集合中的城市 id */
  toRemove: string[]
}

/**
 * 以城市集合本身为准，计算地图标记的同步计划。
 * 不依赖长度差值推断，删除、批量恢复、重复添加都能严格对应。
 */
export function planMarkerSync(
  currentMarkerIds: Iterable<string>,
  cities: readonly City[]
): MarkerSyncPlan {
  const current = new Set(currentMarkerIds)
  const next = new Set(cities.map(c => c.id))
  const toAdd = cities.filter(city => !current.has(city.id))
  const toRemove: string[] = []
  current.forEach(id => {
    if (!next.has(id)) toRemove.push(id)
  })
  return { toAdd, toRemove }
}
