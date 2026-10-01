import React, { useState } from 'react';
import type { ImageComponent } from './types';

interface ArtworkCardProps {
  component: ImageComponent;
  onClick?: () => void;
  readOnly?: boolean;
}

const ArtworkCard: React.FC<ArtworkCardProps> = ({ component, onClick, readOnly = false }) => {
  const [showModal, setShowModal] = useState(false);

  const handleClick = () => {
    if (readOnly) {
      setShowModal(true);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: component.backgroundColor,
          border: `${component.borderWidth}px solid ${component.borderColor}`,
          boxShadow: component.shadow ? '0 4px 16px rgba(0,0,0,0.15)' : 'none',
          opacity: component.opacity,
          borderRadius: '8px',
          overflow: 'hidden',
          cursor: readOnly ? 'pointer' : 'move',
          display: 'flex',
          flexDirection: 'column',
          transform: `rotate(${component.rotation}deg)`,
          transition: 'all 0.2s ease-out'
        }}
      >
        {component.imageUrl ? (
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <img
              src={component.imageUrl}
              alt={component.title}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
              draggable={false}
            />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#ddd',
              color: '#888',
              fontSize: '14px'
            }}
          >
            点击上传图片
          </div>
        )}
        <div style={{ padding: '12px', backgroundColor: 'rgba(255,255,255,0.9)' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#2c2c2c', marginBottom: '4px' }}>
            {component.title || '艺术品标题'}
          </div>
          {component.year && (
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>
              {component.year}
            </div>
          )}
          <div
            style={{
              fontSize: '13px',
              color: '#555',
              lineHeight: 1.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical'
            }}
          >
            {component.description || '艺术品简介'}
          </div>
        </div>
      </div>

      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'fadeIn 0.3s ease-out'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              maxWidth: '80vw',
              maxHeight: '85vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              animation: 'scaleIn 0.3s ease-out'
            }}
          >
            {component.imageUrl && (
              <img
                src={component.imageUrl}
                alt={component.title}
                style={{
                  maxHeight: '50vh',
                  width: '100%',
                  objectFit: 'contain',
                  backgroundColor: '#f5f0e8'
                }}
              />
            )}
            <div style={{ padding: '24px', maxWidth: '600px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', color: '#2c2c2c' }}>
                {component.title}
              </h2>
              {component.year && (
                <div style={{ fontSize: '14px', color: '#888', marginBottom: '16px' }}>
                  创作年代：{component.year}
                </div>
              )}
              <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#555' }}>
                {component.description}
              </p>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  marginTop: '20px',
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#2c2c2c',
                  color: '#fff',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-out'
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
};

export default ArtworkCard;
