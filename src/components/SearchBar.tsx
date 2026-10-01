import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { searchMovies, fetchMovieDetail } from '../utils/api';
import type { SearchResult } from '../types';
import { useMovies } from '../context/MovieContext';

export const SearchBar: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const { addMovie, movies } = useMovies();
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      const data = await searchMovies(query);
      setResults(data);
      setSearching(false);
    }, 400);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAdd = async (result: SearchResult) => {
    if (addingId) return;
    if (movies.find((m) => m.id === result.id)) {
      alert('该电影已在收藏中');
      return;
    }
    setAddingId(result.id);
    const detail = await fetchMovieDetail(result.id);
    if (detail) addMovie(detail);
    setAddingId(null);
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  return (
    <div className="search-bar-wrap" ref={containerRef}>
      <div className={`search-bar ${focused ? 'focused' : ''}`}>
        <Search size={20} className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="搜索电影名称添加到收藏..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            setFocused(true);
            setShowResults(true);
          }}
          onBlur={() => setFocused(false)}
        />
        {searching && <Loader2 size={20} className="search-spinner" />}
      </div>
      {showResults && (query || results.length > 0) && (
        <div className="search-results">
          {searching && results.length === 0 && (
            <div className="search-empty">搜索中...</div>
          )}
          {!searching && results.length === 0 && query && (
            <div className="search-empty">未找到相关电影</div>
          )}
          {results.slice(0, 8).map((item) => {
            const added = movies.some((m) => m.id === item.id);
            const isAdding = addingId === item.id;
            return (
              <div key={item.id} className="search-result-item">
                <div className="search-result-poster">
                  {item.poster && item.poster !== 'N/A' ? (
                    <img src={item.poster} alt={item.title} />
                  ) : (
                    <span>{item.title[0]}</span>
                  )}
                </div>
                <div className="search-result-info">
                  <div className="search-result-title">{item.title}</div>
                  <div className="search-result-year">{item.year}</div>
                </div>
                <button
                  className={`search-add-btn ${added ? 'added' : ''}`}
                  onClick={() => handleAdd(item)}
                  disabled={added || isAdding}
                >
                  {isAdding ? (
                    <Loader2 size={16} className="spinner" />
                  ) : added ? (
                    '已添加'
                  ) : (
                    <Plus size={16} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
