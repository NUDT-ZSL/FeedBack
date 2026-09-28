import React, { useCallback } from 'react';
import type { Photo } from '../types';
import { getTagColor } from '../utils/tagColors';

interface SidebarProps {
  topPhotos: Photo[];
  maxLikes: number;
  allTags: string[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onRankingClick: (photo: Photo) => void;
  isOpen?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  topPhotos,
  maxLikes,
  allTags,
  selectedTags,
  onTagToggle,
  onRankingClick,
  isOpen = true,
}) => {
  const handleTagClick = useCallback((tag: string) => {
    onTagToggle(tag);
  }, [onTagToggle]);

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-section">
        <h2 className="sidebar-title">标签筛选</h2>
        <div className="tag-buttons">
          {allTags.map(tag => (
            <button
              key={tag}
              className={`tag-btn ${selectedTags.includes(tag) ? 'active' : ''}`}
              style={{
                backgroundColor: selectedTags.includes(tag)
                  ? getTagColor(tag)
                  : `${getTagColor(tag)}80`,
              }}
              onClick={() => handleTagClick(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <h2 className="sidebar-title">热度排行</h2>
        <div className="ranking-list">
          {topPhotos.map((photo, index) => (
            <div
              key={photo.id}
              className="ranking-item"
              onClick={() => onRankingClick(photo)}
            >
              <span className={`ranking-number top-${index + 1}`}>
                {index + 1}
              </span>
              <div className="ranking-info">
                <div className="ranking-title">{photo.title}</div>
                <div className="ranking-progress-bar">
                  <div
                    className="ranking-progress-fill"
                    style={{ width: maxLikes > 0 ? `${(photo.likes / maxLikes) * 100}%` : '0%' }}
                  />
                </div>
              </div>
              <span className="ranking-likes">{photo.likes}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default React.memo(Sidebar);
