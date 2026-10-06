import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Movie, FilterState, ImportReport } from '../types';
import { storage } from '../utils/storage';
import { parseImportText, mergeImport } from '../utils/importer';

interface MovieContextType {
  movies: Movie[];
  filter: FilterState;
  loading: boolean;
  addMovie: (movie: Movie) => void;
  updateMovie: (id: string, updates: Partial<Movie>) => void;
  deleteMovie: (id: string) => void;
  setFilter: (filter: FilterState) => void;
  getFilteredMovies: () => Movie[];
  importMovies: (text: string) => { report: ImportReport; history: { repeat: boolean } } | null;
}

const MovieContext = createContext<MovieContextType | undefined>(undefined);

export function MovieProvider({ children }: { children: React.ReactNode }) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [filter, setFilterState] = useState<FilterState>({
    year: null,
    minRating: null,
    watched: null,
    sortBy: 'addedAt',
    sortOrder: 'desc',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadedMovies = storage.getMovies();
    const loadedFilter = storage.getFilter();
    setMovies(loadedMovies);
    setFilterState(loadedFilter);
    setTimeout(() => setLoading(false), 600);
  }, []);

  const addMovie = useCallback((movie: Movie) => {
    setMovies((prev) => {
      if (prev.find((m) => m.id === movie.id)) return prev;
      const next = [movie, ...prev];
      storage.saveMovies(next);
      return next;
    });
  }, []);

  const updateMovie = useCallback((id: string, updates: Partial<Movie>) => {
    setMovies((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, ...updates } : m));
      storage.saveMovies(next);
      return next;
    });
  }, []);

  const deleteMovie = useCallback((id: string) => {
    setMovies((prev) => {
      const next = prev.filter((m) => m.id !== id);
      storage.saveMovies(next);
      return next;
    });
  }, []);

  const setFilter = useCallback((next: FilterState) => {
    setFilterState(next);
    storage.saveFilter(next);
  }, []);

  const importMovies = useCallback((text: string) => {
    let raws;
    try {
      raws = parseImportText(text);
    } catch {
      return null;
    }
    if (raws.length === 0) return null;
    const { movies: next, report } = mergeImport(
      storage.getMovies(),
      raws,
      text,
    );
    const history = storage.getImportHistory();
    const repeat = history.some((h) => h.hash === report.fileHash);
    storage.saveMovies(next);
    storage.addImportHistory({
      hash: report.fileHash,
      importedAt: new Date().toISOString(),
      total: report.total,
      added: report.added,
    });
    setMovies(next);
    return { report, history: { repeat } };
  }, []);

  const getFilteredMovies = useCallback(() => {
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
  }, [movies, filter]);

  return (
    <MovieContext.Provider
      value={{ movies, filter, loading, addMovie, updateMovie, deleteMovie, setFilter, getFilteredMovies, importMovies }}
    >
      {children}
    </MovieContext.Provider>
  );
}

export function useMovies() {
  const ctx = useContext(MovieContext);
  if (!ctx) throw new Error('useMovies must be used within MovieProvider');
  return ctx;
}
