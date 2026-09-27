import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

vi.mock('leaflet', async () => {
  const { createLeafletModule } = await import('./helpers/leafletMock')
  return { default: createLeafletModule(), __esModule: true }
})

vi.mock('html2canvas', () => ({ default: vi.fn(), __esModule: true }))

import html2canvas from 'html2canvas'
import ExportPreview from '../src/components/ExportPreview.vue'
import { useTravelStore } from '../src/store/travelStore'
import { leafletState, liveMarkers, livePolylines } from './helpers/leafletMock'

const h2c = vi.mocked(html2canvas)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function setup() {
  const pinia = createPinia()
  const store = useTravelStore(pinia)
  const wrapper = mount(ExportPreview, {
    props: { visible: false },
    global: { plugins: [pinia] }
  })
  return { wrapper, store }
}

function addCity(store: ReturnType<typeof useTravelStore>, name: string, lat: number, lng: number) {
  return store.addCity({ name, lat, lng, date: '2026-01-01', photo: '', description: '' })
}

function seedCities(store: ReturnType<typeof useTravelStore>) {
  addCity(store, '北京', 39.9, 116.4)
  addCity(store, '上海', 31.2, 121.5)
  addCity(store, '广州', 23.1, 113.3)
}

const headerText = () => document.querySelector('.export-header p')?.textContent ?? ''
const photoCards = () => document.querySelectorAll('.export-photo-card')
const exportBtn = () => document.querySelector('.btn-primary') as HTMLButtonElement

describe('ExportPreview 快照一致性', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    leafletState.reset()
    h2c.mockReset()
    h2c.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,x' } as any)
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    window.alert = vi.fn()
  })

  afterEach(() => {
    clickSpy.mockRestore()
    document.body.innerHTML = ''
  })

  it('打开时固定快照：导出期间增删、激活切换不改变预览', async () => {
    const { wrapper, store } = setup()
    seedCities(store)

    await wrapper.setProps({ visible: true })
    await wait(150)

    expect(headerText()).toContain('共 3 个目的地')
    expect(photoCards().length).toBe(3)
    expect(liveMarkers().length).toBe(3)
    expect(livePolylines()[0].points).toEqual([
      [39.9, 116.4],
      [31.2, 121.5],
      [23.1, 113.3]
    ])

    // 导出预览打开期间发生增删与激活切换
    const shanghai = store.sortedCities[1]
    addCity(store, '深圳', 22.5, 114.1)
    store.removeCity(shanghai.id)
    store.setActiveCity(store.sortedCities[0].id)
    await wait(50)

    // 预览仍渲染打开时的快照
    expect(headerText()).toContain('共 3 个目的地')
    expect(photoCards().length).toBe(3)
    expect(liveMarkers().length).toBe(3)
    expect(leafletState.markers.length).toBe(3)
    expect(livePolylines()[0].points.length).toBe(3)

    wrapper.unmount()
  })

  it('重复触发导出只执行一次截图与下载', async () => {
    const { wrapper, store } = setup()
    seedCities(store)
    await wrapper.setProps({ visible: true })
    await wait(150)

    exportBtn().click()
    exportBtn().click()
    exportBtn().click()
    await wait(700)

    expect(h2c).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('导出进行中关闭：异步回调不再截图或下载，资源被释放', async () => {
    const { wrapper, store } = setup()
    seedCities(store)
    await wrapper.setProps({ visible: true })
    await wait(150)

    exportBtn().click()
    await wait(50)
    await wrapper.setProps({ visible: false })
    await wait(700)

    expect(h2c).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
    expect(leafletState.maps[0].removed).toBe(true)
    expect(liveMarkers().length).toBe(0)
    expect(livePolylines().length).toBe(0)
    wrapper.unmount()
  })

  it('关闭后再次打开：使用与当前排序一致的新快照，旧地图已销毁', async () => {
    const { wrapper, store } = setup()
    seedCities(store)

    await wrapper.setProps({ visible: true })
    await wait(150)
    expect(headerText()).toContain('共 3 个目的地')

    await wrapper.setProps({ visible: false })
    expect(leafletState.maps[0].removed).toBe(true)

    addCity(store, '深圳', 22.5, 114.1)
    await wrapper.setProps({ visible: true })
    await wait(150)

    expect(leafletState.maps.length).toBe(2)
    expect(leafletState.maps[1].removed).toBe(false)
    expect(headerText()).toContain('共 4 个目的地')
    expect(photoCards().length).toBe(4)
    expect(liveMarkers().length).toBe(4)
    expect(livePolylines()[0].points.length).toBe(4)
    wrapper.unmount()
  })

  it('组件卸载时清理会话，不残留地图引用', async () => {
    const { wrapper, store } = setup()
    seedCities(store)
    await wrapper.setProps({ visible: true })
    await wait(150)

    wrapper.unmount()

    expect(leafletState.maps[0].removed).toBe(true)
    expect(liveMarkers().length).toBe(0)
    expect(livePolylines().length).toBe(0)
  })
})
