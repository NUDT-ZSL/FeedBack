import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import type { Exhibition } from './types';

const ExhibitionList: React.FC = () => {
  const navigate = useNavigate();
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExhibitions();
  }, []);

  const fetchExhibitions = async () => {
    try {
      const res = await axios.get('/api/exhibitions');
      setExhibitions(res.data);
    } catch (err) {
      console.error('Failed to fetch exhibitions:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '40px'
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '32px'
          }}
        >
          <div>
            <h1
              style={{
                fontSize: '28px',
                fontWeight: 700,
                color: '#2c2c2c',
                marginBottom: '8px'
              }}
            >
              展览大厅
            </h1>
            <p style={{ fontSize: '14px', color: '#888' }}>
              共 {exhibitions.length} 个在线展览
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#2c2c2c',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease-out'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = 'brightness(1.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'brightness(1)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            + 创建新展览
          </button>
        </div>

        {loading ? (
          <div
            style={{
              textAlign: 'center',
              padding: '80px 20px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)'
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
            <p style={{ fontSize: '16px', color: '#888' }}>加载中...</p>
          </div>
        ) : exhibitions.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '80px 20px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)'
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎨</div>
            <h2 style={{ fontSize: '20px', color: '#2c2c2c', marginBottom: '8px' }}>
              还没有展览
            </h2>
            <p style={{ fontSize: '14px', color: '#888', marginBottom: '24px' }}>
              成为第一个创建虚拟展览的人吧！
            </p>
            <button
              onClick={() => navigate('/')}
              style={{
                padding: '12px 28px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#d4a574',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              立即创建
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '24px'
            }}
          >
            {exhibitions.map((exhibition, index) => (
              <div
                key={exhibition.id}
                onClick={() => navigate(`/exhibition/${exhibition.id}`)}
                style={{
                  backgroundColor: '#fff',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                  transition: 'all 0.3s ease-out',
                  animation: `slideUp 0.5s ease-out ${index * 100}ms both`
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.15)';
                  e.currentTarget.style.transform = 'translateY(-4px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div
                  style={{
                    height: '10px',
                    background: `linear-gradient(90deg, ${exhibition.themeColor.primary} 0%, ${exhibition.themeColor.secondary} 50%, ${exhibition.themeColor.accent} 100%)`
                  }}
                />
                <div
                  style={{
                    height: '160px',
                    backgroundColor: exhibition.themeColor.background,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden'
                  }}
                >
                  {exhibition.thumbnail ? (
                    <img
                      src={exhibition.thumbnail}
                      alt={exhibition.name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '8px' }}>🖼️</div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: exhibition.themeColor.primary,
                          fontWeight: 600
                        }}
                      >
                        {exhibition.components.length} 件展品
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ padding: '16px' }}>
                  <h3
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      color: '#2c2c2c',
                      marginBottom: '6px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {exhibition.name}
                  </h3>
                  <p
                    style={{
                      fontSize: '13px',
                      color: '#888',
                      marginBottom: '12px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      lineHeight: 1.5,
                      minHeight: '39px'
                    }}
                  >
                    {exhibition.description || '暂无描述'}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingTop: '12px',
                      borderTop: '1px solid #f0f0f0'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: '#4caf50'
                        }}
                      />
                      <span style={{ fontSize: '12px', color: '#666' }}>
                        已发布
                      </span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#aaa' }}>
                      {formatDate(exhibition.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(40px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 768px) {
          > div > div:nth-child(2) > div:last-child {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ExhibitionList;
