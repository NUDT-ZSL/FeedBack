import React, { useMemo } from 'react';
import PhotoCard from './PhotoCard';
import type { Photo } from '../types';

interface GalleryProps {
  photos: Photo[];
  onLike: (id: number) => void;
  onPhotoClick: (photo: Photo) => void;
}

const Gallery: React.FC<GalleryProps> = ({ photos, onLike, onPhotoClick }) => {
  const photoCards = useMemo(() => {
    return photos.map(photo => (
      <PhotoCard
        key={photo.id}
        photo={photo}
        onLike={onLike}
        onClick={onPhotoClick}
      />
    ));
  }, [photos, onLike, onPhotoClick]);

  return (
    <div className="gallery">
      {photos.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: 'var(--text-secondary)',
          fontSize: '16px'
        }}>
          没有找到匹配的作品
        </div>
      ) : (
        <div className="gallery-grid">
          {photoCards}
        </div>
      )}
    </div>
  );
};

export default React.memo(Gallery);
