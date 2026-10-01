import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2, Check } from 'lucide-react';
import type { Movie } from '../types';
import { useMovies } from '../context/MovieContext';

interface MovieCardProps {
  movie: Movie;
  onEdit?: (movie: Movie) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, onEdit }) => {
  const { updateMovie, deleteMovie } = useMovies();
  const [imageError, setImageError] = useState(false);

  const handleToggleWatched = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateMovie(movie.id, { watched: !movie.watched });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`确定要删除《${movie.title}》吗？`)) {
      deleteMovie(movie.id);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onEdit) onEdit(movie);
  };

  return (
    <Link to={`/movie/${movie.id}`} className="movie-card">
      <div className="movie-card-inner">
        <div className="movie-poster-wrap">
          {!imageError && movie.poster ? (
            <img
              src={movie.poster}
              alt={movie.title}
              className="movie-poster"
              loading="lazy"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="movie-poster-placeholder">
              <span>{movie.title}</span>
            </div>
          )}
          {movie.watched && (
            <div className="watched-badge">
              <Check size={14} /> 已看
            </div>
          )}
          <div className="movie-overlay">
            <button className="overlay-btn" onClick={handleToggleWatched} title={movie.watched ? '标记为未看' : '标记为已看'}>
              <Check size={18} />
            </button>
            {onEdit && (
              <button className="overlay-btn" onClick={handleEdit} title="编辑">
                <Pencil size={18} />
              </button>
            )}
            <button className="overlay-btn overlay-btn-danger" onClick={handleDelete} title="删除">
              <Trash2 size={18} />
            </button>
          </div>
        </div>
        <div className="movie-info">
          <h3 className="movie-title">{movie.title}</h3>
          <div className="movie-meta">
            <span>{movie.year || '未知年份'}</span>
            {movie.personalRating !== null && (
              <span className="movie-rating">
                ★ {movie.personalRating.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
};
