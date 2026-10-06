import type { Movie, FilterState, ImportHistoryEntry } from '../types';

const MOVIES_KEY = 'movie_collection_movies';
const FILTER_KEY = 'movie_collection_filter';
const IMPORT_HISTORY_KEY = 'movie_collection_import_history';

export const storage = {
  getMovies(): Movie[] {
    try {
      const data = localStorage.getItem(MOVIES_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveMovies(movies: Movie[]): void {
    localStorage.setItem(MOVIES_KEY, JSON.stringify(movies));
  },

  addMovie(movie: Movie): void {
    const movies = this.getMovies();
    if (!movies.find((m) => m.id === movie.id)) {
      movies.unshift(movie);
      this.saveMovies(movies);
    }
  },

  updateMovie(id: string, updates: Partial<Movie>): void {
    const movies = this.getMovies();
    const index = movies.findIndex((m) => m.id === id);
    if (index !== -1) {
      movies[index] = { ...movies[index], ...updates };
      this.saveMovies(movies);
    }
  },

  deleteMovie(id: string): void {
    const movies = this.getMovies().filter((m) => m.id !== id);
    this.saveMovies(movies);
  },

  getFilter(): FilterState {
    try {
      const data = localStorage.getItem(FILTER_KEY);
      if (data) return JSON.parse(data);
    } catch {
    }
    return {
      year: null,
      minRating: null,
      watched: null,
      sortBy: 'addedAt',
      sortOrder: 'desc',
    };
  },

  saveFilter(filter: FilterState): void {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  },

  getImportHistory(): ImportHistoryEntry[] {
    try {
      const data = localStorage.getItem(IMPORT_HISTORY_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  addImportHistory(entry: ImportHistoryEntry): void {
    const history = this.getImportHistory().filter((h) => h.hash !== entry.hash);
    history.unshift(entry);
    localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  },
};
