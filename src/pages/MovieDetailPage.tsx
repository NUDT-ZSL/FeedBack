import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Star, Calendar, User, Film as FilmIcon, Edit2, Save, X } from 'lucide-react';
import { useMovies } from '../context/MovieContext';
import type { Movie } from '../types';

export const MovieDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { movies, updateMovie } = useMovies();
  const [editing, setEditing] = useState(false);
  const [editRating, setEditRating] = useState<number>(0);
  const [editDate, setEditDate] = useState<string>('');

  const movie = useMemo(() => movies.find((m) => m.id === id), [movies, id]);

  const recommendations = useMemo(() => {
    if (!movie) return [] as Movie[];
    const genres = movie.genre.split(',').map((g) => g.trim().toLowerCase()).filter(Boolean);
    const director = movie.director.trim().toLowerCase();
    return movies
      .filter((m) => {
        if (m.id === movie.id) return false;
        const mGenres = m.genre.split(',').map((g) => g.trim().toLowerCase());
        const genreMatch = genres.some((g) => mGenres.includes(g));
        const directorMatch = director && m.director.trim().toLowerCase() === director;
        return genreMatch || directorMatch;
      })
      .slice(0, 6);
  }, [movie, movies]);

  if (!movie) {
    return (
      <div className="detail-page">
        <div className="detail-container">
          <button className="back-btn" onClick={() => navigate('/')}>
            <ArrowLeft size={20} /> 返回
          </button>
          <div className="empty-state">
            <h3>未找到该电影</h3>
            <Link to="/">返回首页</Link>
          </div>
        </div>
      </div>
    );
  }

  const handleStartEdit = () => {
    setEditRating(movie.personalRating ?? 0);
    setEditDate(movie.watchDate ?? '');
    setEditing(true);
  };

  const handleSave = () => {
    updateMovie(movie.id, {
      personalRating: editRating > 0 ? editRating : null,
      watchDate: editDate || null,
    });
    setEditing(false);
  };

  return (
    <div className="detail-page">
      <div className="detail-bg" style={{ backgroundImage: `url(${movie.poster})` }} />
      <div className="detail-container">
        <button className="back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={20} /> 返回收藏
        </button>

        <div className="detail-content">
          <div className="detail-poster">
            {movie.poster ? (
              <img src={movie.poster} alt={movie.title} />
            ) : (
              <div className="detail-poster-placeholder">{movie.title}</div>
            )}
          </div>

          <div className="detail-info">
            <h1 className="detail-title">{movie.title}</h1>
            <div className="detail-meta">
              {movie.year && (
                <span className="meta-item">
                  <Calendar size={16} /> {movie.year}
                </span>
              )}
              {movie.director && (
                <span className="meta-item">
                  <User size={16} /> {movie.director}
                </span>
              )}
              {movie.genre && (
                <span className="meta-item">
                  <FilmIcon size={16} /> {movie.genre}
                </span>
              )}
              {movie.watched && <span className="meta-item meta-watched">已观看</span>}
            </div>

            {movie.plot && <p className="detail-plot">{movie.plot}</p>}

            <div className="personal-section">
              <div className="personal-header">
                <h2>个人评价</h2>
                {!editing ? (
                  <button className="edit-btn" onClick={handleStartEdit}>
                    <Edit2 size={16} /> 编辑
                  </button>
                ) : (
                  <div className="edit-actions">
                    <button className="icon-btn" onClick={() => setEditing(false)}>
                      <X size={16} /> 取消
                    </button>
                    <button className="icon-btn save-btn" onClick={handleSave}>
                      <Save size={16} /> 保存
                    </button>
                  </div>
                )}
              </div>

              {!editing ? (
                <div className="personal-display">
                  <div className="rating-display">
                    <Star size={20} className="star-icon" />
                    <span className="rating-number">
                      {movie.personalRating !== null ? movie.personalRating.toFixed(1) : '未评分'}
                    </span>
                  </div>
                  {movie.watchDate && (
                    <div className="watch-date">
                      <Calendar size={16} /> 观影于 {movie.watchDate}
                    </div>
                  )}
                </div>
              ) : (
                <div className="personal-edit">
                  <div className="form-group">
                    <label>个人评分</label>
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
                </div>
              )}
            </div>
          </div>
        </div>

        {recommendations.length > 0 && (
          <div className="recommend-section">
            <h2 className="recommend-title">相关推荐</h2>
            <div className="recommend-list">
              {recommendations.map((rec) => (
                <Link to={`/movie/${rec.id}`} key={rec.id} className="recommend-card">
                  {rec.poster ? (
                    <img src={rec.poster} alt={rec.title} />
                  ) : (
                    <div className="recommend-placeholder">{rec.title}</div>
                  )}
                  <div className="recommend-overlay">
                    <div className="recommend-name">{rec.title}</div>
                    {rec.personalRating !== null && (
                      <div className="recommend-rating">★ {rec.personalRating.toFixed(1)}</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
