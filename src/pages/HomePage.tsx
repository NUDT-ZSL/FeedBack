import React, { useState } from 'react';
import { Film, X } from 'lucide-react';
import { SearchBar } from '../components/SearchBar';
import { FilterPanel } from '../components/FilterPanel';
import { MovieList } from '../components/MovieList';
import { useMovies } from '../context/MovieContext';
import type { Movie } from '../types';

export const HomePage: React.FC = () => {
  const { movies, updateMovie } = useMovies();
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
  const [editRating, setEditRating] = useState<number>(0);
  const [editDate, setEditDate] = useState<string>('');
  const [editWatched, setEditWatched] = useState(false);

  const handleEdit = (movie: Movie) => {
    setEditingMovie(movie);
    setEditRating(movie.personalRating ?? 0);
    setEditDate(movie.watchDate ?? '');
    setEditWatched(movie.watched);
  };

  const handleSaveEdit = () => {
    if (!editingMovie) return;
    updateMovie(editingMovie.id, {
      personalRating: editRating > 0 ? editRating : null,
      watchDate: editDate || null,
      watched: editWatched,
    });
    setEditingMovie(null);
  };

  return (
    <div className="home-page">
      <header className="app-header">
        <div className="header-inner">
          <div className="app-logo">
            <Film size={28} className="logo-icon" />
            <span className="logo-text">CineVault</span>
          </div>
          <SearchBar />
          <div className="collection-count">
            <span className="count-num">{movies.length}</span>
            <span className="count-label">部电影</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <FilterPanel />
        <MovieList onEdit={handleEdit} />
      </main>

      {editingMovie && (
        <div className="modal-backdrop" onClick={() => setEditingMovie(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>编辑《{editingMovie.title}》</h3>
              <button className="modal-close" onClick={() => setEditingMovie(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>个人评分（0-10）</label>
                <div className="rating-input">
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={editRating}
                    onChange={(e) => setEditRating(Number(e.target.value))}
                  />
                  <span className="rating-value">{editRating.toFixed(1)}</span>
                </div>
              </div>
              <div className="form-group">
                <label>观影日期</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={editWatched}
                    onChange={(e) => setEditWatched(e.target.checked)}
                  />
                  已观看
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditingMovie(null)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
