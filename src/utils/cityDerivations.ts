import type { City } from '../types'

export function sortCities(cities: readonly City[]): City[] {
  return [...cities].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function deriveRoutePoints(sortedCities: readonly City[]): [number, number][] {
  return sortedCities.map(city => [city.lat, city.lng])
}

export function deriveCityNumbers(sortedCities: readonly City[]): Map<string, number> {
  return new Map(sortedCities.map((city, index) => [city.id, index + 1]))
}

export interface CityListDiff {
  added: City[]
  removed: string[]
}

export function diffCityLists(prev: readonly City[], next: readonly City[]): CityListDiff {
  const prevIds = new Set(prev.map(city => city.id))
  const nextIds = new Set(next.map(city => city.id))
  return {
    added: next.filter(city => !prevIds.has(city.id)),
    removed: prev.filter(city => !nextIds.has(city.id)).map(city => city.id)
  }
}
