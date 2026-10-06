export interface Movie {
  id: string;
  title: string;
  year: number | null;
  director: string;
  plot: string;
  poster: string;
  genre: string;
  personalRating: number | null;
  watchDate: string | null;
  watched: boolean | null;
  addedAt: string;
  source?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  year: string;
  poster: string;
  type: string;
}

export interface FilterState {
  year: number | null;
  minRating: number | null;
  watched: boolean | null;
  sortBy: 'rating' | 'addedAt';
  sortOrder: 'asc' | 'desc';
}
