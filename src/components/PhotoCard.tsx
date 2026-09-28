import React, { memo, useState, useCallback } from 'react';
import { ThumbsUp } from 'lucide-react';
import type { Photo } from '../types';
import { getTagColor } from '../utils/tagColors';

interface PhotoCardProps {
  photo: Photo;
  onLike: (id: number) => void;
  onClick: (photo: Photo) => void;
}

const PhotoCard: React.FC<PhotoCardProps> = memo(function PhotoCard({ photo, onLike, onClick }) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [likeKey, setLikeKey] = useState(0);

  const handleLike = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAnimating) return;
    setIsAnimating(true);
    setLikeKey(prev => prev + 1);
    onLike(photo.id);
    setTimeout(() => setIsAnimating(false), 200);
  }, [photo.id, onLike, isAnimating]);

  const handleCardClick = useCallback(() => {
    onClick(photo);
  }, [photo, onClick]);

  return (
    <div className="photo-card" onClick={handleCardClick}>
      <img src={photo.url} alt={photo.title} className="photo-image" loading="lazy" />
      <div className="photo-overlay">
        <h3 className="photo-title">{photo.title}</h3>
        <div className="photo-tags">
          {photo.tags.map(tag => (
            <span
              key={tag}
              className="photo-tag"
              style={{ backgroundColor: getTagColor(tag) }}
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="photo-actions">
          <button
            className={`like-btn ${isAnimating ? 'animating' : ''}`}
            onClick={handleLike}
          >
            <ThumbsUp size={16} />
            <span className="like-count">
              <span key={likeKey} className="like-count-number">{photo.likes}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.photo.likes === nextProps.photo.likes &&
         prevProps.photo.id === nextProps.photo.id;
});

export default PhotoCard;
