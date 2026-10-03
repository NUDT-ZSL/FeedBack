import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTravelStore } from './travelStore'
import {
  sortCities,
  deriveRoutePoints,
  deriveCityNumbers,
  diffCityLists
} from '../utils/cityDerivations'
import type { City, SearchResult } from '../types'

const STORAGE_KEY = 'travel-footprint-cities'

function installLocalStorageStub() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear()
  })
}

function makeCity(id: string, name: string, createdAt: number): City {
  return {
    id,
    name,
    lat: Math.round(createdAt % 90),
    lng: Math.round(createdAt % 180),
    date: '2026-01-01',
    photo: '',
    description: '',
    createdAt
  }
}

function seed(name: string, createdAt: number): ReturnType<typeof makeCity> {
  const city = makeCity(`city-${name}`, name, createdAt)
  ;(seedData as Map<string, ReturnType<typeof makeCity>>).set(name, city)
  return city
}

const seedData = new Map<string, City>()

function syncMarkers(
  markerIds: Set<string>,
  prev: readonly City[],
  next: readonly City[]
) {
  const { added, removed } = diffCityLists(prev, next)
  removed.forEach(id => markerIds.delete(id))
  added.forEach(city => markerIds.add(city.id))
  return { added, removed }
}

describe('city derivation single source', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    installLocalStorageStub()
    seedData.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sorts cities by createdAt with deterministic tie-break', () => {
    const cities = [
      makeCity('b', 'B', 200),
      makeCity('a', 'A', 100),
      makeCity('z', 'Z', 200)
    ]
    const sorted = sortCities(cities)
    expect(sorted.map(c => c.id)).toEqual(['a', 'b', 'z'])
  })

  it('route points and numbering are derived in sorted order', () => {
    const sorted = sortCities([
      makeCity('b', 'B', 200),
      makeCity('a', 'A', 100)
    ])
    expect(deriveRoutePoints(sorted)).toEqual([
      [sorted[0].lat, sorted[0].lng],
      [sorted[1].lat, sorted[1].lng]
    ])
    expect([...deriveCityNumbers(sorted).entries()]).toEqual([
      ['a', 1],
      ['b', 2]
    ])
  })

  it('keeps sidebar, map markers, route and export preview consistent across add/remove sequences', () => {
    const store = useTravelStore()
    const markerIds = new Set<string>()
    let prev: readonly City[] = []

    const assertConsistent = (step: string) => {
      const sorted = store.sortedCities

      expect(store.cityCount, `${step}: count`).toBe(sorted.length)

      // sidebar order === store sorted order
      expect(
        sorted.map((city, index) => store.sortedCities[index].id),
        `${step}: sidebar order`
      ).toEqual(sorted.map(city => city.id))

      // map marker set === sorted id set
      expect([...markerIds].sort(), `${step}: marker set`).toEqual(
        sorted.map(city => city.id).sort()
      )

      // route polyline point count === city count (and <2 => no line)
      expect(store.routePoints.length, `${step}: route point count`).toBe(sorted.length)
      if (sorted.length >= 2) {
        expect(store.routePoints, `${step}: route coordinates`).toEqual(
          sorted.map(city => [city.lat, city.lng])
        )
      }

      // export preview list order === sidebar order (preview caps at 6)
      const displayCities = sorted.slice(0, 6)
      expect(displayCities.map(city => city.id), `${step}: export order`).toEqual(
        store.sortedCities.slice(0, 6).map(city => city.id)
      )

      // export marker number === sidebar/photo list number (1-based, contiguous)
      const numbers = store.cityNumbers
      displayCities.forEach((city, index) => {
        expect(numbers.get(city.id), `${step}: number for ${city.id}`).toBe(index + 1)
      })
      sorted.forEach((city, index) => {
        expect(numbers.get(city.id), `${step}: full numbering ${city.id}`).toBe(index + 1)
      })
    }

    const addViaStore = (city: City) => {
      const before = store.sortedCities
      store.cities.push(city)
      const after = store.sortedCities
      const change = syncMarkers(markerIds, before, after)
      expect(change.removed, `add ${city.name}: no removal`).toEqual([])
      expect(change.added.map(c => c.id), `add ${city.name}: only new marker`).toEqual([city.id])
      prev = after
      assertConsistent(`after add ${city.name}`)
    }

    const removeViaStore = (id: string) => {
      const before = store.sortedCities
      store.removeCity(id)
      const after = store.sortedCities
      const change = syncMarkers(markerIds, before, after)
      expect(change.added, `remove ${id}: no addition`).toEqual([])
      expect(change.removed, `remove ${id}: only that marker`).toEqual([id])
      prev = after
      assertConsistent(`after remove ${id}`)
    }

    const beijing = seed('北京', 1000)
    const shanghai = seed('上海', 2000)
    const chengdu = seed('成都', 3000)
    const hangzhou = seed('杭州', 4000)
    const xian = seed('西安', 5000)
    const dali = seed('大理', 6000)
    const lijiang = seed('丽江', 7000)

    addViaStore(beijing)
    addViaStore(shanghai)
    addViaStore(chengdu)
    assertConsistent('3 cities: one route line, 2 points expected count=3')

    // delete the middle city: only its marker disappears; others keep order
    removeViaStore(shanghai.id)
    expect([...markerIds], 'markers after middle delete').toEqual([beijing.id, chengdu.id])
    expect(store.cityNumbers.get(chengdu.id), 'renumbered to 2').toBe(2)
    expect(store.routePoints.map(p => p.join(',')), 'route still links survivors').toEqual([
      [beijing.lat, beijing.lng].join(','),
      [chengdu.lat, chengdu.lng].join(',')
    ])

    // add more: export preview caps at 6 but numbering stays contiguous across all cities
    addViaStore(hangzhou)
    addViaStore(xian)
    addViaStore(dali)
    addViaStore(lijiang)
    expect(store.cityCount).toBe(6)
    expect(store.cityNumbers.get(lijiang.id)).toBe(6)

    // delete first city: numbering of every remaining city shifts consistently
    removeViaStore(beijing.id)
    assertConsistent('after removing first city')
    expect(store.cityNumbers.get(chengdu.id)).toBe(1)

    // delete last city
    removeViaStore(lijiang.id)
    expect(store.routePoints.length).toBe(4)
    assertConsistent('final')
  })

  it('preserves city fields and localStorage key across persistence', () => {
    const store = useTravelStore()
    const stored: City[] = [
      {
        id: 'legacy-1',
        name: '北京',
        lat: 39.9042,
        lng: 116.4074,
        date: '2026-05-01',
        photo: 'data:image/png;base64,xxxx',
        description: '# hi',
        createdAt: 123
      }
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    store.loadFromStorage()
    expect(store.cities).toEqual(stored)
    expect(store.sortedCities[0].id).toBe('legacy-1')

    store.saveToStorage()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(stored)
  })

  it('diff reports only added and only removed ids for mixed sequences', () => {
    const a = makeCity('a', 'A', 1)
    const b = makeCity('b', 'B', 2)
    const c = makeCity('c', 'C', 3)
    expect(diffCityLists([a, b], [b, c])).toEqual({ added: [c], removed: ['a'] })
    expect(diffCityLists([a], [a])).toEqual({ added: [], removed: [] })
  })
})
