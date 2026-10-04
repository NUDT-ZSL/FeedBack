import type { House, FilterState, SortType } from '../types'

export const DEFAULT_FILTER: FilterState = {
  priceMin: null,
  priceMax: null,
  areaMin: null,
  areaMax: null,
  layout: null
}

export const SORT_TYPES: SortType[] = ['timeDesc', 'priceAsc', 'priceDesc']

export function normalizeFilter(raw?: Partial<FilterState> | null): FilterState {
  const source = raw ?? {}
  const toBound = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    priceMin: toBound(source.priceMin),
    priceMax: toBound(source.priceMax),
    areaMin: toBound(source.areaMin),
    areaMax: toBound(source.areaMax),
    layout: typeof source.layout === 'string' && source.layout !== '' ? source.layout : null
  }
}

export function filterHouses(houses: House[], rawFilter?: Partial<FilterState> | null): House[] {
  const f = normalizeFilter(rawFilter)
  return houses.filter(h => {
    if (f.priceMin !== null && h.price < f.priceMin) return false
    if (f.priceMax !== null && h.price > f.priceMax) return false
    if (f.areaMin !== null && h.area < f.areaMin) return false
    if (f.areaMax !== null && h.area > f.areaMax) return false
    if (f.layout !== null && h.layout !== f.layout) return false
    return true
  })
}

export function sortHouses(houses: House[], sortType: SortType): House[] {
  const result = [...houses]
  switch (sortType) {
    case 'priceAsc':
      result.sort((a, b) => a.price - b.price || a.id - b.id)
      break
    case 'priceDesc':
      result.sort((a, b) => b.price - a.price || a.id - b.id)
      break
    case 'timeDesc':
    default:
      result.sort((a, b) => b.publishTime - a.publishTime || a.id - b.id)
      break
  }
  return result
}

export function selectHouses(
  houses: House[],
  rawFilter?: Partial<FilterState> | null,
  sortType: SortType = 'timeDesc'
): House[] {
  return sortHouses(filterHouses(houses, rawFilter), sortType)
}

export function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...list]
  const isValid =
    Number.isInteger(fromIndex) &&
    Number.isInteger(toIndex) &&
    fromIndex >= 0 &&
    fromIndex < result.length &&
    toIndex >= 0 &&
    toIndex < result.length
  if (!isValid || fromIndex === toIndex) return result
  const [item] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, item)
  return result
}
