import React, { useMemo, useState, useEffect } from 'react';
import { MovieCard } from './MovieCard';
import { SkeletonCard } from './SkeletonCard';
import { useMovies } from '../context/MovieContext';
import type { Movie } from '../types';

interface MovieListProps {
  onEdit?: (movie: Movie) => void;
}

export const MovieList: React.FC<MovieListProps> = ({ onEdit }) => {
  const { loading, getFilteredMovies, filter } = useMovies();
  const [visible, setVisible] = useState(true);
  const [displayMovies, setDisplayMovies] = useState<Movie[]>([]);

  const filtered = useMemo(() => getFilteredMovies(), [getFilteredMovies, filter]);

  useEffect(() => {
    setVisible(false);
    const timer = setTimeout(() => {
      setDisplayMovies(filtered);
      setVisible(true);
    }, 150);
    return () => clearTimeout(timer);
  }, [filtered]);

  if (loading) {
    return (
      <div className="movie-grid">
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (displayMovies.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎬</div>
        <h3>还没有收藏电影</h3>
        <p>在上方搜索栏搜索电影，添加到你的个人收藏吧</p>
      </div>
    );
  }

  return (
    <div className={`movie-grid ${visible ? 'fade-in' : 'fade-out'}`}>
      {displayMovies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} onEdit={onEdit} />
      ))}
    </div>
  );
};
