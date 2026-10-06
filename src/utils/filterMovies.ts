import type { Movie, FilterState } from '../types/index.ts';

export function applyFilter(movies: Movie[], filter: FilterState): Movie[] {
  let result = [...movies];
  if (filter.year !== null) {
    result = result.filter((m) => m.year === filter.year);
  }
  if (filter.minRating !== null) {
    result = result.filter((m) => (m.personalRating ?? 0) >= filter.minRating!);
  }
  if (filter.watched !== null) {
    result = result.filter((m) => m.watched === filter.watched);
  }
  result.sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;
    if (filter.sortBy === 'rating') {
      av = a.personalRating ?? -1;
      bv = b.personalRating ?? -1;
    } else {
      av = a.addedAt;
      bv = b.addedAt;
    }
    if (av < bv) return filter.sortOrder === 'asc' ? -1 : 1;
    if (av > bv) return filter.sortOrder === 'asc' ? 1 : -1;
    return 0;
  });
  return result;
}
