import type { Movie, FilterState } from '../types';
import type { ImportReport, PendingDecision } from './import/types';

const MOVIES_KEY = 'movie_collection_movies';
const FILTER_KEY = 'movie_collection_filter';
const DECISIONS_KEY = 'movie_collection_import_decisions';
const LAST_IMPORT_KEY = 'movie_collection_last_import';

function migrateMovie(m: Movie): Movie {
  return {
    ...m,
    year: typeof m.year === 'number' && m.year > 0 ? m.year : null,
    watched: typeof m.watched === 'boolean' ? m.watched : (m.watched ?? null),
  };
}

export const storage = {
  getMovies(): Movie[] {
    try {
      const data = localStorage.getItem(MOVIES_KEY);
      const list: Movie[] = data ? JSON.parse(data) : [];
      return list.map(migrateMovie);
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
      // 解析失败时回退到默认筛选
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

  getImportDecisions(batchId: string): Record<string, PendingDecision> {
    try {
      const data = localStorage.getItem(DECISIONS_KEY);
      const all = data ? JSON.parse(data) : {};
      return all[batchId] ?? {};
    } catch {
      return {};
    }
  },

  saveImportDecision(batchId: string, clusterKey: string, decision: PendingDecision): void {
    let all: Record<string, Record<string, PendingDecision>> = {};
    try {
      const data = localStorage.getItem(DECISIONS_KEY);
      all = data ? JSON.parse(data) : {};
    } catch {
      all = {};
    }
    all[batchId] = { ...(all[batchId] ?? {}), [clusterKey]: decision };
    localStorage.setItem(DECISIONS_KEY, JSON.stringify(all));
  },

  getLastImportReport(): ImportReport | null {
    try {
      const data = localStorage.getItem(LAST_IMPORT_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  saveLastImportReport(report: ImportReport): void {
    localStorage.setItem(LAST_IMPORT_KEY, JSON.stringify(report));
  },
};
