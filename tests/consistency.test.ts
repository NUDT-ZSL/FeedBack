import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTravelStore } from '../src/store/travelStore'
import { planCitySync } from '../src/utils/citySync'
import type { CitySyncPlan } from '../src/utils/citySync'
import type { City } from '../src/types'

const STORAGE_KEY = 'travel-footprint-cities'

function makeStorageStub() {
  const data: Record<string, string> = {}
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
    clear: () => {
      Object.keys(data).forEach(key => delete data[key])
    }
  }
}

// 模拟 MapView 的渲染层：与组件一样只通过 planCitySync 的结果驱动，
// 主路线折线点集 = 最近一次 plan 的 routePoints（少于 2 个点时无折线）。
class SimulatedMapView {
  markers = new Map<string, City>()
  polylinePoints: [number, number][] = []

  applyPlan(plan: CitySyncPlan) {
    plan.cityIdsToRemove.forEach(id => this.markers.delete(id))
    plan.citiesToAdd.forEach(city => this.markers.set(city.id, city))
    this.polylinePoints = plan.routePoints.length >= 2 ? plan.routePoints : []
  }
}

let store: ReturnType<typeof useTravelStore>
let view: SimulatedMapView
let previousSorted: City[]

function sortedIds(): string[] {
  return store.sortedCities.map(city => city.id)
}

// 每一步增删后执行：与 MapView 相同的同步入口 + 全量一致性断言
function syncAndAssertConsistent() {
  const plan = planCitySync(previousSorted, store.sortedCities)
  view.applyPlan(plan)
  previousSorted = [...store.sortedCities]

  const expectedIds = sortedIds()

  // 侧边栏顺序 = store.sortedCities（按 createdAt 升序，并列保持插入顺序）
  const byCreatedAt = [...store.cities]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(city => city.id)
  expect(expectedIds).toEqual(byCreatedAt)

  // 地图标记集合 = 侧边栏城市集合
  expect([...view.markers.keys()].sort()).toEqual([...expectedIds].sort())
  expectedIds.forEach(id => {
    expect(view.markers.get(id)?.name).toBe(store.cities.find(c => c.id === id)?.name)
  })

  // 路线折线点数 = 城市数（>=2 时），且坐标顺序与侧边栏一致
  expect(view.polylinePoints.length).toBe(expectedIds.length >= 2 ? expectedIds.length : 0)
  expect(view.polylinePoints).toEqual(expectedIds.length >= 2 ? store.routePoints : [])
  store.sortedCities.forEach((city, index) => {
    if (index < view.polylinePoints.length) {
      expect(view.polylinePoints[index]).toEqual([city.lat, city.lng])
    }
  })

  // 导出预览城市列表 = 侧边栏前 6 个，编号 = 在侧边栏中的位次
  expect(store.exportDisplayCities.map(city => city.id)).toEqual(expectedIds.slice(0, 6))
  store.sortedCities.forEach((city, index) => {
    expect(store.citySerialById.get(city.id)).toBe(index + 1)
  })
  store.exportDisplayCities.forEach(city => {
    expect(store.citySerialById.get(city.id)).toBe(expectedIds.indexOf(city.id) + 1)
  })

  expect(store.cityCount).toBe(expectedIds.length)
  return plan
}

function addCity(name: string, lat: number, lng: number) {
  return store.addCity({ name, lat, lng, date: '2026-01-01', photo: '', description: '' })
}

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTravelStore()
  view = new SimulatedMapView()
  previousSorted = []
})

describe('城市数据单一来源一致性', () => {
  it('连续新增：标记、路线、导出列表与侧边栏始终一致，且每次只追加新段', () => {
    const added: City[] = []
    const names = ['北京', '上海', '广州', '成都', '西安', '杭州', '南京', '武汉']
    names.forEach((name, index) => {
      const city = addCity(name, 30 + index, 100 + index)
      added.push(city)

      const plan = syncAndAssertConsistent()

      // 新增只影响新增城市与新增段
      expect(plan.cityIdsToRemove).toEqual([])
      expect(plan.citiesToAdd.map(c => c.id)).toEqual([city.id])
      if (index === 0) {
        expect(plan.routeMode).toBe('none')
        expect(view.polylinePoints.length).toBe(0)
      } else {
        expect(plan.routeMode).toBe('append')
        // 新增段 = 上一段终点 + 新城市，共 2 个点，不重放整条路线
        expect(plan.appendedPoints).toEqual([
          [added[index - 1].lat, added[index - 1].lng],
          [city.lat, city.lng]
        ])
      }
    })
    expect(store.sortedCities.map(c => c.name)).toEqual(names)
  })

  it('删除：只移除对应标记，其余状态保持一致', () => {
    const beijing = addCity('北京', 39.9, 116.4)
    const shanghai = addCity('上海', 31.2, 121.5)
    const guangzhou = addCity('广州', 23.1, 113.3)
    addCity('成都', 30.6, 104.1)
    syncAndAssertConsistent()

    // 删除中间城市
    store.removeCity(shanghai.id)
    let plan = syncAndAssertConsistent()
    expect(plan.citiesToAdd).toEqual([])
    expect(plan.cityIdsToRemove).toEqual([shanghai.id])
    expect(plan.routeMode).toBe('update')
    expect(view.markers.has(shanghai.id)).toBe(false)
    expect(view.markers.size).toBe(3)

    // 删到只剩 1 个：折线消失，标记仍在
    store.removeCity(guangzhou.id)
    syncAndAssertConsistent()
    store.removeCity(beijing.id)
    plan = syncAndAssertConsistent()
    expect(view.polylinePoints.length).toBe(0)
    expect(view.markers.size).toBe(1)

    // 删除不存在的 id：无副作用
    store.removeCity('not-exist')
    plan = syncAndAssertConsistent()
    expect(plan.routeMode).toBe('none')
    expect(plan.citiesToAdd).toEqual([])
    expect(plan.cityIdsToRemove).toEqual([])
  })

  it('混合增删序列：任意操作后四处视图一致', () => {
    const ops: Array<() => void> = []
    const cities: City[] = []
    const names = ['东京', '大阪', '首尔', '新加坡', '曼谷', '巴黎', '伦敦', '纽约', '悉尼']

    names.forEach((name, index) => {
      ops.push(() => {
        cities.push(addCity(name, 35 - index, 139 - index))
      })
    })
    ops.push(() => store.removeCity(cities[2].id))
    ops.push(() => store.removeCity(cities[0].id))
    ops.push(() => cities.push(addCity('拉萨', 29.7, 91.2)))
    ops.push(() => store.removeCity(cities[5].id))
    ops.push(() => cities.push(addCity('哈尔滨', 45.8, 126.5)))
    ops.push(() => store.removeCity(cities[9].id))

    ops.forEach(op => {
      op()
      syncAndAssertConsistent()
    })

    // 最终只剩 8 个（导出预览只展示前 6 个，编号仍与侧边栏位次一致）
    expect(store.cityCount).toBe(7)
    expect(store.exportDisplayCities.length).toBe(6)
    store.exportDisplayCities.forEach((city, index) => {
      expect(store.citySerialById.get(city.id)).toBe(index + 1)
    })
  })

  it('本地存储：键名与字段保持不变，加载后派生结果一致', () => {
    const storage = makeStorageStub()
    ;(globalThis as any).localStorage = storage

    const tokyo = addCity('东京', 35.68, 139.65)
    addCity('巴黎', 48.86, 2.35)
    store.saveToStorage()

    // 存储键不变
    expect(Object.keys(storage.data)).toEqual([STORAGE_KEY])
    const raw = JSON.parse(storage.data[STORAGE_KEY]) as any[]
    expect(raw.length).toBe(2)
    // 字段集合不变
    expect(Object.keys(raw[0]).sort()).toEqual(
      ['createdAt', 'date', 'description', 'id', 'lat', 'lng', 'name', 'photo'].sort()
    )
    expect(raw[0].id).toBe(tokyo.id)

    // 模拟刷新：新 store 从存储恢复
    setActivePinia(createPinia())
    store = useTravelStore()
    store.loadFromStorage()
    view = new SimulatedMapView()
    previousSorted = []
    syncAndAssertConsistent()
    expect(sortedIds()).toContain(tokyo.id)
  })

  it('乱序 createdAt 加载：排序只由 store 决定，所有视图跟随同一结果', () => {
    const storage = makeStorageStub()
    ;(globalThis as any).localStorage = storage

    const base = Date.now()
    const saved: City[] = [
      { id: 'c3', name: '广州', lat: 23.1, lng: 113.3, date: '2026-03-01', photo: '', description: '', createdAt: base + 3000 },
      { id: 'c1', name: '北京', lat: 39.9, lng: 116.4, date: '2026-01-01', photo: '', description: '', createdAt: base + 1000 },
      { id: 'c2', name: '上海', lat: 31.2, lng: 121.5, date: '2026-02-01', photo: '', description: '', createdAt: base + 2000 }
    ]
    storage.setItem(STORAGE_KEY, JSON.stringify(saved))

    store.loadFromStorage()
    const plan = syncAndAssertConsistent()

    // 侧边栏顺序按 createdAt，而非存储顺序
    expect(sortedIds()).toEqual(['c1', 'c2', 'c3'])
    expect(store.exportDisplayCities.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(store.citySerialById.get('c1')).toBe(1)
    expect(store.citySerialById.get('c3')).toBe(3)
    expect(view.polylinePoints).toEqual([
      [39.9, 116.4],
      [31.2, 121.5],
      [23.1, 113.3]
    ])
    expect(plan.citiesToAdd.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
  })
})
