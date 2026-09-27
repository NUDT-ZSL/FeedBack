import { useState, useEffect, useCallback } from 'react';
import type { TravelEvent } from '../api/travelApi';

interface DetailPanelProps {
  event: TravelEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string) => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${week[d.getDay()]}`;
}

export default function DetailPanel({
  event,
  isOpen,
  onClose,
  onShowToast,
}: DetailPanelProps) {
  const [currentImage, setCurrentImage] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'next' | 'prev'>('next');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    setCurrentImage(0);
    setImageLoaded(false);
  }, [event?.id]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!isOpen || !event) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' && event.images.length > 0) {
        nextImage();
      } else if (e.key === 'ArrowLeft' && event.images.length > 0) {
        prevImage();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, event]);

  const nextImage = useCallback(() => {
    if (!event || event.images.length === 0) return;
    setSlideDirection('next');
    setImageLoaded(false);
    setCurrentImage((prev) => (prev + 1) % event.images.length);
  }, [event]);

  const prevImage = useCallback(() => {
    if (!event || event.images.length === 0) return;
    setSlideDirection('prev');
    setImageLoaded(false);
    setCurrentImage((prev) => (prev - 1 + event.images.length) % event.images.length);
  }, [event]);

  const handleCopyText = () => {
    if (!event) return;
    const text = `【${event.location}】\n时间：${formatDate(event.date)}\n地点：${event.country} · ${event.location}\n标签：${event.tags.map((t) => '#' + t).join(' ')}\n\n${event.description}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => onShowToast('已复制'),
        () => fallbackCopy(text),
      );
    } else {
      fallbackCopy(text);
    }
  };

  const fallbackCopy = (text: string) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      onShowToast('已复制');
    } catch {
      onShowToast('复制失败');
    }
    document.body.removeChild(ta);
  };

  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '90vh',
        background: '#FAFAFA',
        zIndex: 200,
        borderTopLeftRadius: '20px',
        borderTopRightRadius: '20px',
        transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.15)',
      }
    : {
        position: 'fixed',
        top: '60px',
        right: 0,
        width: '520px',
        maxWidth: '100%',
        height: 'calc(100vh - 60px)',
        background: '#FAFAFA',
        zIndex: 200,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderLeft: '1px solid #E8E0D8',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.08)',
      };

  if (!event) {
    return (
      <>
        {isOpen && !isMobile && (
          <div
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: '60px 0 0 0',
              zIndex: 199,
              animation: 'fadeIn 0.3s',
            }}
          />
        )}
        <div style={panelStyle} />
      </>
    );
  }

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: isMobile ? 0 : '60px 0 0 0',
            background: isMobile ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)',
            zIndex: 199,
            animation: 'fadeIn 0.3s',
          }}
        />
      )}
      <div style={panelStyle}>
        {isMobile && (
          <div style={{ padding: '12px 0 0', textAlign: 'center' }}>
            <div
              style={{
                width: '40px',
                height: '4px',
                borderRadius: '2px',
                background: '#D0C8C0',
                margin: '0 auto',
              }}
            />
          </div>
        )}

        <div
          style={{
            padding: isMobile ? '12px 20px 16px' : '20px 24px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #E8E0D8',
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span style={{ color: '#4A90D9', fontSize: isMobile ? '13px' : '14px', fontWeight: 600 }}>
                {formatDate(event.date)}
              </span>
            </div>
            <h2 style={{
              fontSize: isMobile ? '20px' : '22px',
              fontWeight: 700,
              color: '#333',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {event.location}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
              transition: 'all 0.2s',
              marginLeft: '12px',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#E8E0D8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {event.images.length > 0 && (
            <div style={{
              position: 'relative',
              width: '100%',
              paddingTop: isMobile ? '66.67%' : '56.25%',
              background: '#E8E0D8',
              flexShrink: 0,
              overflow: 'hidden',
            }}>
              {!imageLoaded && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(90deg, #E8E0D8 0%, #F0E8E0 50%, #E8E0D8 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite',
                  }}
                />
              )}
              <img
                key={currentImage + '-' + slideDirection}
                src={event.images[currentImage]}
                alt={`${event.location}-${currentImage + 1}`}
                onLoad={() => setImageLoaded(true)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: imageLoaded ? 1 : 0,
                  transition: 'opacity 0.3s ease',
                  animation: `slideHorizontally 0.3s ease`,
                  ['--slide-direction' as string]: slideDirection === 'next' ? '30px' : '-30px',
                } as React.CSSProperties}
              />

              {event.images.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      prevImage();
                    }}
                    style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.45)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0,0,0,0.65)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(0,0,0,0.45)';
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      nextImage();
                    }}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.45)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0,0,0,0.65)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(0,0,0,0.45)';
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>

                  <div
                    style={{
                      position: 'absolute',
                      bottom: '12px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      display: 'flex',
                      gap: '6px',
                    }}
                  >
                    {event.images.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSlideDirection(idx > currentImage ? 'next' : 'prev');
                          setImageLoaded(false);
                          setCurrentImage(idx);
                        }}
                        style={{
                          width: idx === currentImage ? '24px' : '8px',
                          height: '8px',
                          borderRadius: '4px',
                          background: idx === currentImage ? '#fff' : 'rgba(255,255,255,0.5)',
                          transition: 'all 0.3s',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ padding: isMobile ? '20px' : '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span style={{ color: '#2E7D32', fontSize: '14px', fontWeight: 600 }}>
                  {event.country} · {event.location}
                </span>
              </div>
            </div>

            {event.tags.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {event.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: '4px 12px',
                      background: '#fff',
                      border: '1px solid #E8E0D8',
                      borderRadius: '14px',
                      fontSize: '13px',
                      color: '#666',
                      fontWeight: 500,
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#333', marginBottom: '10px' }}>
                旅行描述
              </h3>
              <p style={{
                color: '#333333',
                lineHeight: 1.8,
                fontSize: '15px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {event.description}
              </p>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: isMobile ? '12px 20px calc(12px + env(safe-area-inset-bottom))' : '16px 24px 20px',
            borderTop: '1px solid #E8E0D8',
            display: 'flex',
            gap: '12px',
            background: '#FAFAFA',
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleCopyText}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '10px',
              background: '#fff',
              border: '1px solid #E8E0D8',
              fontSize: '14px',
              fontWeight: 600,
              color: '#333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#F5F0EB';
              e.currentTarget.style.borderColor = '#D0C8C0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff';
              e.currentTarget.style.borderColor = '#E8E0D8';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            复制文本
          </button>
        </div>

        <style>{`
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>
    </>
  );
}
