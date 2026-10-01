import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import type { Exhibition, ExhibitionComponent, ImageComponent } from './types';
import ArtworkCard from './ArtworkCard';

const ExhibitionView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [fadeState, setFadeState] = useState<'in' | 'out'>('in');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (id) {
      fetchExhibition();
    }
  }, [id]);

  const fetchExhibition = async () => {
    try {
      const res = await axios.get(`/api/exhibitions/${id}`);
      setExhibition(res.data);
    } catch (err) {
      console.error('Failed to fetch exhibition:', err);
    }
  };

  useEffect(() => {
    if (!exhibition || exhibition.components.length === 0) return;

    const startTimer = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (!isPaused) {
          setFadeState('out');
          setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % exhibition.components.length);
            setFadeState('in');
          }, 400);
        }
      }, 5000);
    };

    startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [exhibition, isPaused]);

  if (!exhibition) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          color: '#888'
        }}
      >
        加载中...
      </div>
    );
  }

  const components = exhibition.components;
  const currentComponent: ExhibitionComponent | undefined = components[currentIndex];
  const themeColor = exhibition.themeColor;

  const goToSlide = (index: number) => {
    setFadeState('out');
    setTimeout(() => {
      setCurrentIndex(index);
      setFadeState('in');
    }, 400);
  };

  const prevSlide = () => {
    setFadeState('out');
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + components.length) % components.length);
      setFadeState('in');
    }, 400);
  };

  const nextSlide = () => {
    setFadeState('out');
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % components.length);
      setFadeState('in');
    }, 400);
  };

  const renderSlideContent = (comp: ExhibitionComponent) => {
    const baseStyle: React.CSSProperties = {
      backgroundColor: comp.backgroundColor,
      border: `${comp.borderWidth}px solid ${comp.borderColor}`,
      boxShadow: comp.shadow ? '0 8px 32px rgba(0,0,0,0.12)' : 'none',
      opacity: comp.opacity,
      borderRadius: '12px',
      overflow: 'hidden',
      transform: `rotate(${comp.rotation}deg)`,
      maxWidth: '90vw',
      maxHeight: '70vh'
    };

    switch (comp.type) {
      case 'image':
        return (
          <div style={{ ...baseStyle, width: Math.min(comp.width * 1.2, 500) }}>
            <ArtworkCard component={comp as ImageComponent} readOnly />
          </div>
        );
      case 'text':
        return (
          <div
            style={{
              ...baseStyle,
              width: Math.min(comp.width * 1.3, 600),
              padding: '40px',
              fontSize: comp.fontSize * 1.2,
              fontWeight: comp.bold ? 700 : 400,
              fontStyle: comp.italic ? 'italic' : 'normal',
              color: comp.textColor,
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap'
            }}
          >
            {comp.content || '暂无内容'}
          </div>
        );
      case 'divider':
        return (
          <div
            style={{
              ...baseStyle,
              width: Math.min(comp.width * 1.5, 600),
              padding: '40px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div
              style={{
                width: '100%',
                height: comp.thickness * 2,
                backgroundColor: comp.color,
                borderRadius: '2px'
              }}
            />
          </div>
        );
      case 'banner':
        return (
          <div
            style={{
              ...baseStyle,
              width: Math.min(comp.width * 1.2, 700),
              padding: '48px 60px',
              backgroundColor: comp.backgroundColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div
              style={{
                fontSize: comp.fontSize * 1.2,
                color: comp.textColor,
                fontWeight: 700,
                textAlign: 'center',
                lineHeight: 1.4
              }}
            >
              {comp.text}
            </div>
          </div>
        );
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: themeColor.background,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 10,
          background: `linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, transparent 100%)`
        }}
      >
        <button
          onClick={() => navigate('/list')}
          style={{
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'rgba(255,255,255,0.9)',
            color: '#2c2c2c',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s ease-out'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.9)';
          }}
        >
          ← 返回展览列表
        </button>
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: '#fff',
              textShadow: '0 2px 8px rgba(0,0,0,0.3)',
              marginBottom: '4px'
            }}
          >
            {exhibition.name}
          </h1>
          <p
            style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.8)',
              textShadow: '0 1px 4px rgba(0,0,0,0.3)'
            }}
          >
            {exhibition.description}
          </p>
        </div>
        <div style={{ width: '120px', textAlign: 'right' }}>
          <span
            style={{
              fontSize: '14px',
              color: 'rgba(255,255,255,0.9)',
              fontWeight: 600,
              textShadow: '0 1px 4px rgba(0,0,0,0.3)'
            }}
          >
            {currentIndex + 1} / {components.length}
          </span>
        </div>
      </div>

      <div
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: '100px 40px'
        }}
      >
        {components.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#888' }}>
            <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎨</div>
            <p style={{ fontSize: '18px' }}>展览内容为空</p>
          </div>
        ) : (
          <>
            <button
              onClick={prevSlide}
              style={{
                position: 'absolute',
                left: '24px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'rgba(0,0,0,0.3)',
                color: '#fff',
                fontSize: '24px',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                transition: 'all 0.2s ease-out',
                zIndex: 5
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.3)';
              }}
            >
              ‹
            </button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: fadeState === 'in' ? 1 : 0,
                transition: 'opacity 0.4s ease-out',
                transform: fadeState === 'in' ? 'scale(1)' : 'scale(0.98)'
              }}
            >
              {currentComponent && renderSlideContent(currentComponent)}
            </div>

            <button
              onClick={nextSlide}
              style={{
                position: 'absolute',
                right: '24px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'rgba(0,0,0,0.3)',
                color: '#fff',
                fontSize: '24px',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                transition: 'all 0.2s ease-out',
                zIndex: 5
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.3)';
              }}
            >
              ›
            </button>
          </>
        )}
      </div>

      {components.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 20px',
            borderRadius: '999px',
            backgroundColor: 'rgba(0,0,0,0.3)',
            backdropFilter: 'blur(8px)'
          }}
        >
          {components.map((_, idx) => (
            <button
              key={idx}
              onClick={() => goToSlide(idx)}
              style={{
                width: idx === currentIndex ? '28px' : '8px',
                height: '8px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: idx === currentIndex ? themeColor.primary : 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                transition: 'all 0.3s ease-out'
              }}
            />
          ))}
        </div>
      )}

      {isPaused && components.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '12px 24px',
            borderRadius: '8px',
            backgroundColor: 'rgba(0,0,0,0.6)',
            color: '#fff',
            fontSize: '14px',
            pointerEvents: 'none',
            zIndex: 20,
            backdropFilter: 'blur(4px)'
          }}
        >
          ⏸ 播放已暂停
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          > div:first-child {
            padding: 16px !important;
            flex-direction: column !important;
            gap: 8px;
          }
          > div:first-child > div {
            width: 100% !important;
            text-align: center !important;
          }
          > div:nth-child(2) {
            padding: 140px 16px 100px !important;
          }
          > div:nth-child(2) > button:first-child,
          > div:nth-child(2) > button:last-child {
            width: 40px !important;
            height: 40px !important;
            font-size: 20px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ExhibitionView;
