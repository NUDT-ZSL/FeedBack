import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { artworkApi } from './api';
import { Artwork } from './types';
import { useToast } from './ToastContext';

const ArtGallery: React.FC = () => {
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    const fetchArtworks = async () => {
      try {
        const response = await artworkApi.getArtworks();
        if (response.code === 200 && response.data) {
          setArtworks(response.data);
        } else {
          showToast(response.message);
        }
      } catch (error) {
        showToast('获取艺术品列表失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    };
    fetchArtworks();
  }, [showToast]);

  const isLowStock = (stock: number, limitedEdition: number) => {
    return stock / limitedEdition < 0.2;
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="gallery-page">
      <div className="page-header">
        <h1>限量艺术品</h1>
        <p className="subtitle">每一件都是独一无二的匠心之作</p>
      </div>

      <div className="artwork-grid">
        {artworks.map((artwork) => (
          <div
            key={artwork.id}
            className="artwork-card"
            onClick={() => navigate(`/artwork/${artwork.id}`)}
          >
            <div className="card-image">
              <img src={artwork.thumbnail} alt={artwork.title} loading="lazy" />
              <div className="card-badge">
                限量 {artwork.limitedEdition} 件
              </div>
            </div>
            <div className="card-content">
              <h3 className="card-title">{artwork.title}</h3>
              <p className="card-artist">by {artwork.artistName}</p>
              <div className="card-footer">
                <span className="card-price">¥{artwork.price}</span>
                <span
                  className={`card-stock ${
                    isLowStock(artwork.stock, artwork.limitedEdition) ? 'low-stock' : ''
                  }`}
                >
                  仅剩 {artwork.stock} 件
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ArtGallery;
