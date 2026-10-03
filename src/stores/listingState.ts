import type { House, FilterState, SortType } from '@/types'

export interface ListingState {
  filter: FilterState
  sortType: SortType
  favoriteIds: number[]
}

export const LISTING_STORAGE_KEY = 'rental_listing_state_v1'
export const LEGACY_FAVORITES_STORAGE_KEY = 'rental_favorites'

const SORT_TYPES: readonly SortType[] = ['timeDesc', 'priceAsc', 'priceDesc']

export function createDefaultFilter(): FilterState {
  return {
    priceMin: null,
    priceMax: null,
    areaMin: null,
    areaMax: null,
    layout: null
  }
}

export function createDefaultListingState(): ListingState {
  return {
    filter: createDefaultFilter(),
    sortType: 'timeDesc',
    favoriteIds: []
  }
}

function toBound(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return num
}

function toLayout(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function normalizeFilter(raw?: Partial<FilterState> | null): FilterState {
  const source: Partial<FilterState> = raw ?? {}
  const filter: FilterState = {
    priceMin: toBound(source.priceMin),
    priceMax: toBound(source.priceMax),
    areaMin: toBound(source.areaMin),
    areaMax: toBound(source.areaMax),
    layout: toLayout(source.layout)
  }
  if (filter.priceMin !== null && filter.priceMax !== null && filter.priceMin > filter.priceMax) {
    const tmp = filter.priceMin
    filter.priceMin = filter.priceMax
    filter.priceMax = tmp
  }
  if (filter.areaMin !== null && filter.areaMax !== null && filter.areaMin > filter.areaMax) {
    const tmp = filter.areaMin
    filter.areaMin = filter.areaMax
    filter.areaMax = tmp
  }
  return filter
}

export function normalizeSortType(raw: unknown): SortType {
  return SORT_TYPES.includes(raw as SortType) ? (raw as SortType) : 'timeDesc'
}

export function normalizeFavoriteIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const ids: number[] = []
  for (const item of raw) {
    const id = typeof item === 'number' ? item : Number(item)
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function matchesFilter(house: House, filter: FilterState): boolean {
  if (filter.priceMin !== null && house.price < filter.priceMin) return false
  if (filter.priceMax !== null && house.price > filter.priceMax) return false
  if (filter.areaMin !== null && house.area < filter.areaMin) return false
  if (filter.areaMax !== null && house.area > filter.areaMax) return false
  if (filter.layout !== null && house.layout !== filter.layout) return false
  return true
}

export function applyFilter(houses: readonly House[], filter: FilterState): House[] {
  return houses.filter(h => matchesFilter(h, filter))
}

export function applySort(houses: readonly House[], sortType: SortType): House[] {
  const sorted = [...houses]
  switch (sortType) {
    case 'priceAsc':
      sorted.sort((a, b) => a.price - b.price || a.id - b.id)
      break
    case 'priceDesc':
      sorted.sort((a, b) => b.price - a.price || a.id - b.id)
      break
    case 'timeDesc':
    default:
      sorted.sort((a, b) => b.publishTime - a.publishTime || a.id - b.id)
      break
  }
  return sorted
}

export function queryHouses(
  houses: readonly House[],
  filter: Partial<FilterState> | null,
  sortType: SortType
): House[] {
  return applySort(applyFilter(houses, normalizeFilter(filter)), normalizeSortType(sortType))
}

export function toggleFavoriteId(ids: readonly number[], houseId: number): number[] {
  return ids.includes(houseId) ? ids.filter(id => id !== houseId) : [...ids, houseId]
}

export function moveFavoriteId(ids: readonly number[], fromIndex: number, toIndex: number): number[] {
  const len = ids.length
  if (
    len === 0 ||
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    fromIndex >= len
  ) {
    return [...ids]
  }
  const clampedTo = Math.min(Math.max(toIndex, 0), len - 1)
  if (fromIndex === clampedTo) return [...ids]
  const next = [...ids]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(clampedTo, 0, moved)
  return next
}

export function resolveFavoriteHouses(houses: readonly House[], favoriteIds: readonly number[]): House[] {
  const byId = new Map(houses.map(h => [h.id, h]))
  const result: House[] = []
  for (const id of favoriteIds) {
    const house = byId.get(id)
    if (house) result.push(house)
  }
  return result
}

export function serializeListingState(state: ListingState): string {
  return JSON.stringify({
    version: 1,
    filter: normalizeFilter(state.filter),
    sortType: normalizeSortType(state.sortType),
    favoriteIds: normalizeFavoriteIds(state.favoriteIds)
  })
}

export function parseListingState(
  json: string | null | undefined,
  legacyFavoritesJson?: string | null
): ListingState {
  if (typeof json === 'string' && json !== '') {
    try {
      const raw = JSON.parse(json)
      if (raw && typeof raw === 'object') {
        return {
          filter: normalizeFilter(raw.filter as Partial<FilterState>),
          sortType: normalizeSortType(raw.sortType),
          favoriteIds: normalizeFavoriteIds(raw.favoriteIds)
        }
      }
    } catch {
      // fall through to defaults + legacy migration
    }
  }
  const fallback = createDefaultListingState()
  if (typeof legacyFavoritesJson === 'string' && legacyFavoritesJson !== '') {
    try {
      fallback.favoriteIds = normalizeFavoriteIds(JSON.parse(legacyFavoritesJson))
    } catch {
      // ignore corrupted legacy payload
    }
  }
  return fallback
}
