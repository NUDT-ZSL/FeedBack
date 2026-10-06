import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { Movie, FilterState } from '../types';
import { storage } from '../utils/storage';
import { normalizeAll } from '../utils/import/normalize';
import { computeBatchId, runImport } from '../utils/import/mergeImport';
import type { ImportReport, PendingDecision } from '../utils/import/types';
import { applyFilter } from '../utils/filterMovies';

interface MovieContextType {
  movies: Movie[];
  filter: FilterState;
  loading: boolean;
  lastImport: ImportReport | null;
  addMovie: (movie: Movie) => void;
  updateMovie: (id: string, updates: Partial<Movie>) => void;
  deleteMovie: (id: string) => void;
  setFilter: (filter: FilterState) => void;
  getFilteredMovies: () => Movie[];
  importMovies: (rawRecords: unknown[]) => ImportReport;
  decidePending: (clusterKey: string, decision: PendingDecision) => ImportReport | null;
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
  const [lastImport, setLastImport] = useState<ImportReport | null>(null);
  const lastRawRef = useRef<{ batchId: string; raw: unknown[] } | null>(null);

  useEffect(() => {
    const loadedMovies = storage.getMovies();
    const loadedFilter = storage.getFilter();
    setMovies(loadedMovies);
    setFilterState(loadedFilter);
    setLastImport(storage.getLastImportReport());
    setTimeout(() => setLoading(false), 600);
  }, []);

  const runBatch = useCallback((raw: unknown[]) => {
    const batchId = computeBatchId(raw);
    const decisions = storage.getImportDecisions(batchId);
    const records = normalizeAll(raw);
    const result = runImport({ existing: storage.getMovies(), records, batchId, decisions });
    storage.saveMovies(result.movies);
    storage.saveLastImportReport(result.report);
    setMovies(result.movies);
    setLastImport(result.report);
    lastRawRef.current = { batchId, raw };
    return result.report;
  }, []);

  const importMovies = useCallback(
    (rawRecords: unknown[]) => runBatch(rawRecords),
    [runBatch],
  );

  const decidePending = useCallback(
    (clusterKey: string, decision: PendingDecision) => {
      const last = lastRawRef.current;
      if (!last) return null;
      storage.saveImportDecision(last.batchId, clusterKey, decision);
      return runBatch(last.raw);
    },
    [runBatch],
  );

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

  const getFilteredMovies = useCallback(() => {
    return applyFilter(movies, filter);
  }, [movies, filter]);

  return (
    <MovieContext.Provider
      value={{ movies, filter, loading, lastImport, addMovie, updateMovie, deleteMovie, setFilter, getFilteredMovies, importMovies, decidePending }}
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
