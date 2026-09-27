import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('leaflet', async () => {
  const { createLeafletModule } = await import('./helpers/leafletMock')
  return { default: createLeafletModule(), __esModule: true }
})

import MapView from '../src/components/MapView.vue'
import { useTravelStore } from '../src/store/travelStore'
import { leafletState, liveMarkers, livePolylines } from './helpers/leafletMock'

async function flush() {
  await nextTick()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

function addCity(store: ReturnType<typeof useTravelStore>, name: string, lat: number, lng: number) {
  return store.addCity({ name, lat, lng, date: '2026-01-01', photo: '', description: '' })
}

function expectMapInSync(store: ReturnType<typeof useTravelStore>) {
  const sorted = store.sortedCities
  const live = liveMarkers()

  // 标记与集合严格一一对应
  expect(live.length).toBe(sorted.length)
  const markerCoords = live.map(m => m.latlng.join(',')).sort()
  const cityCoords = sorted.map(c => `${c.lat},${c.lng}`).sort()
  expect(markerCoords).toEqual(cityCoords)

  // 路线与当前排序严格对应
  const lines = livePolylines()
  if (sorted.length >= 2) {
    expect(lines.length).toBe(1)
    expect(lines[0].points).toEqual(sorted.map(c => [c.lat, c.lng]))
  } else {
    expect(lines.length).toBe(0)
  }
}

describe('MapView 标记/路线与城市集合同步', () => {
  beforeEach(() => {
    leafletState.reset()
  })

  function setup() {
    const pinia = createPinia()
    const wrapper = mount(MapView, { global: { plugins: [pinia] } })
    const store = useTravelStore(pinia)
    return { wrapper, store, pinia }
  }

  it('挂载时渲染已有城市与路线', async () => {
    const { wrapper, store } = setup()
    addCity(store, '北京', 39.9, 116.4)
    addCity(store, '上海', 31.2, 121.5)
    await flush()
    expectMapInSync(store)
    wrapper.unmount()
  })

  it('新增城市后标记、路线同步，并飞往新城市', async () => {
    const { wrapper, store } = setup()
    await flush()

    addCity(store, '北京', 39.9, 116.4)
    await flush()
    addCity(store, '上海', 31.2, 121.5)
    await flush()

    expectMapInSync(store)
    const map = leafletState.maps[0]
    expect(map.flyTo).toHaveBeenCalled()
    const lastCall = map.flyTo.mock.calls[map.flyTo.mock.calls.length - 1]
    expect(lastCall[0]).toEqual([31.2, 121.5])
    wrapper.unmount()
  })

  it('删除城市后对应标记被移除、路线重连', async () => {
    const { wrapper, store } = setup()
    await flush()
    const a = addCity(store, '北京', 39.9, 116.4)
    const b = addCity(store, '上海', 31.2, 121.5)
    const c = addCity(store, '广州', 23.1, 113.3)
    await flush()
    expectMapInSync(store)

    store.removeCity(b.id)
    await flush()
    expectMapInSync(store)
    expect(livePolylines()[0].points).toEqual([
      [a.lat, a.lng],
      [c.lat, c.lng]
    ])
    wrapper.unmount()
  })

  it('快速连续增删后仍与最终集合严格一致', async () => {
    const { wrapper, store } = setup()
    await flush()
    const a = addCity(store, '北京', 39.9, 116.4)
    addCity(store, '上海', 31.2, 121.5)
    await flush()

    // 不等待渲染，连续操作
    const c = addCity(store, '广州', 23.1, 113.3)
    store.removeCity(a.id)
    addCity(store, '深圳', 22.5, 114.1)
    store.removeCity(c.id)
    await flush()

    expectMapInSync(store)
    expect(store.sortedCities.map(x => x.name)).toEqual(['上海', '深圳'])
    wrapper.unmount()
  })

  it('同一城市重复添加产生两个独立标记与路线点', async () => {
    const { wrapper, store } = setup()
    await flush()
    addCity(store, '北京', 39.9, 116.4)
    addCity(store, '北京', 39.9, 116.4)
    await flush()

    expect(store.sortedCities.length).toBe(2)
    expectMapInSync(store)
    wrapper.unmount()
  })

  it('删除后批量恢复，标记与路线仍严格对应', async () => {
    const { wrapper, store } = setup()
    await flush()
    const a = addCity(store, '北京', 39.9, 116.4)
    const b = addCity(store, '上海', 31.2, 121.5)
    addCity(store, '广州', 23.1, 113.3)
    await flush()

    store.removeCity(a.id)
    store.removeCity(b.id)
    await flush()
    expectMapInSync(store)

    addCity(store, '成都', 30.6, 104.1)
    addCity(store, '杭州', 30.3, 120.2)
    await flush()
    expectMapInSync(store)
    wrapper.unmount()
  })

  it('卸载后地图被销毁，无残留标记与路线', async () => {
    const { wrapper, store } = setup()
    addCity(store, '北京', 39.9, 116.4)
    addCity(store, '上海', 31.2, 121.5)
    await flush()

    const map = leafletState.maps[0]
    wrapper.unmount()

    expect(map.remove).toHaveBeenCalled()
    expect(map.removed).toBe(true)
    expect(liveMarkers().length).toBe(0)
    expect(livePolylines().length).toBe(0)
  })
})
