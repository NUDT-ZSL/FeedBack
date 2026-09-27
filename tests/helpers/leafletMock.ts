import { vi } from 'vitest'

/**
 * 共享的 Leaflet 测试替身：记录所有地图、标记、折线的创建与销毁，
 * 供组件测试断言“标记/路线与城市集合严格对应、资源被释放”。
 */

export interface FakeMarker {
  latlng: [number, number]
  iconHtml: string
  map: FakeMap | null
  removed: boolean
  on: ReturnType<typeof vi.fn>
  addTo: (map: FakeMap) => FakeMarker
  remove: () => FakeMarker
}

export interface FakePolyline {
  points: [number, number][]
  options: Record<string, unknown>
  map: FakeMap | null
  removed: boolean
  addTo: (map: FakeMap) => FakePolyline
  remove: () => FakePolyline
  getElement: () => null
}

export interface FakeMap {
  options: Record<string, unknown>
  removed: boolean
  on: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  flyTo: ReturnType<typeof vi.fn>
  getZoom: () => number
  invalidateSize: ReturnType<typeof vi.fn>
  fitBounds: ReturnType<typeof vi.fn>
}

export const leafletState = {
  maps: [] as FakeMap[],
  markers: [] as FakeMarker[],
  polylines: [] as FakePolyline[],
  reset() {
    this.maps = []
    this.markers = []
    this.polylines = []
  }
}

export function liveMarkers(): FakeMarker[] {
  return leafletState.markers.filter(m => m.map !== null && !m.removed)
}

export function livePolylines(): FakePolyline[] {
  return leafletState.polylines.filter(p => p.map !== null && !p.removed)
}

export function createLeafletModule() {
  const L: Record<string, unknown> = {}

  L.map = vi.fn((_el: unknown, options: Record<string, unknown>) => {
    const map: FakeMap = {
      options,
      removed: false,
      on: vi.fn(),
      remove: vi.fn(() => {
        map.removed = true
        leafletState.markers.forEach(m => {
          if (m.map === map) m.remove()
        })
        leafletState.polylines.forEach(p => {
          if (p.map === map) p.remove()
        })
      }),
      flyTo: vi.fn(),
      getZoom: () => 4,
      invalidateSize: vi.fn(),
      fitBounds: vi.fn()
    }
    leafletState.maps.push(map)
    return map
  })

  L.tileLayer = vi.fn(() => ({ addTo: vi.fn() }))

  L.control = { zoom: vi.fn(() => ({ addTo: vi.fn() })) }

  L.divIcon = vi.fn((options: Record<string, unknown>) => ({ options }))

  L.marker = vi.fn((latlng: [number, number], options: { icon?: { options?: { html?: string } } }) => {
    const marker: FakeMarker = {
      latlng,
      iconHtml: options?.icon?.options?.html ?? '',
      map: null,
      removed: false,
      on: vi.fn(),
      addTo(map: FakeMap) {
        marker.map = map
        return marker
      },
      remove() {
        marker.removed = true
        marker.map = null
        return marker
      }
    }
    leafletState.markers.push(marker)
    return marker
  })

  L.polyline = vi.fn((points: [number, number][], options: Record<string, unknown>) => {
    const polyline: FakePolyline = {
      points,
      options,
      map: null,
      removed: false,
      addTo(map: FakeMap) {
        polyline.map = map
        return polyline
      },
      remove() {
        polyline.removed = true
        polyline.map = null
        return polyline
      },
      getElement: () => null
    }
    leafletState.polylines.push(polyline)
    return polyline
  })

  L.latLngBounds = vi.fn((points: [number, number][]) => ({
    getCenter: () => {
      const lat = points.reduce((s, p) => s + p[0], 0) / points.length
      const lng = points.reduce((s, p) => s + p[1], 0) / points.length
      return { lat, lng }
    }
  }))

  L.DomEvent = { stopPropagation: vi.fn() }

  return L
}
