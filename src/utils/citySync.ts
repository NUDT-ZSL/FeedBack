import type { City } from '../types'

export type RouteSyncMode = 'none' | 'append' | 'update'

export interface CitySyncPlan {
  citiesToAdd: City[]
  cityIdsToRemove: string[]
  routePoints: [number, number][]
  routeMode: RouteSyncMode
  appendedPoints: [number, number][]
}

export function toLatLngs(list: readonly City[]): [number, number][] {
  return list.map(city => [city.lat, city.lng])
}

export function planCitySync(
  previous: readonly City[],
  current: readonly City[]
): CitySyncPlan {
  const previousIds = previous.map(city => city.id)
  const currentIds = current.map(city => city.id)
  const previousIdSet = new Set(previousIds)
  const currentIdSet = new Set(currentIds)

  const citiesToAdd = current.filter(city => !previousIdSet.has(city.id))
  const cityIdsToRemove = previousIds.filter(id => !currentIdSet.has(id))

  const routePoints = toLatLngs(current)

  const isAppendOnly =
    cityIdsToRemove.length === 0 &&
    citiesToAdd.length > 0 &&
    previousIds.every((id, index) => currentIds[index] === id)

  let routeMode: RouteSyncMode
  let appendedPoints: [number, number][] = []

  if (citiesToAdd.length === 0 && cityIdsToRemove.length === 0) {
    routeMode = 'none'
  } else if (isAppendOnly && previous.length > 0) {
    routeMode = 'append'
    appendedPoints = routePoints.slice(previous.length - 1)
  } else if (routePoints.length >= 2) {
    routeMode = 'update'
  } else {
    routeMode = 'none'
  }

  return {
    citiesToAdd,
    cityIdsToRemove,
    routePoints,
    routeMode,
    appendedPoints
  }
}
