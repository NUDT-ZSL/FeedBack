import React, { useState, useEffect, useCallback } from 'react';
import { X, Calendar, ThumbsUp, Tag } from 'lucide-react';
import type { Photo } from '../types';
import { formatDate } from '../utils/sort';
import { getTagColor } from '../utils/tagColors';

interface PhotoModalProps {
  photo: Photo | null;
  onClose: () => void;
}

const PhotoModal: React.FC<PhotoModalProps> = ({ photo, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    if (photo) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [photo]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  }, [onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }, [handleClose]);

  if (!photo) return null;

  return (
    <div
      className={`modal-overlay ${isClosing ? 'closing' : ''}`}
      onClick={handleOverlayClick}
    >
      <div className="modal-content">
        <button
          className="modal-close-btn"
          onClick={handleClose}
          aria-label="关闭"
        >
          <X size={20} />
        </button>
        <img src={photo.url} alt={photo.title} className="modal-image" />
        <div className="modal-body">
          <h2 className="modal-title">{photo.title}</h2>
          <div className="modal-tags">
            {photo.tags.map(tag => (
              <span
                key={tag}
                className="photo-tag"
                style={{ backgroundColor: getTagColor(tag), color: '#fff', padding: '6px 12px', fontSize: '13px' }}
              >
                <Tag size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                {tag}
              </span>
            ))}
          </div>
          <div className="modal-info">
            <span className="modal-info-item">
              <Calendar size={16} />
              {formatDate(photo.date)}
            </span>
            <span className="modal-info-item">
              <ThumbsUp size={16} />
              {photo.likes} 次点赞
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotoModal;
