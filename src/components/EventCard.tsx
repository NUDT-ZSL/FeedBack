import { useState } from 'react';
import type { TravelEvent } from '../api/travelApi';

interface EventCardProps {
  event: TravelEvent;
  index: number;
  isSelected: boolean;
  isExportSelected: boolean;
  onToggleExport: (id: string) => void;
  onDoubleClick: (event: TravelEvent) => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${year}年${month}月${day}日`;
}

function LazyImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#E8E0D8',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {!loaded && !error && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, #E8E0D8 0%, #F0E8E0 50%, #E8E0D8 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s infinite',
        }} />
      )}
      {error ? (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#E8E0D8',
          color: '#999',
          fontSize: '14px',
        }}>图片加载失败</div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.4s ease',
            display: 'block',
          }}
        />
      )}
    </div>
  );
}

export default function EventCard({
  event,
  index,
  isSelected,
  isExportSelected,
  onToggleExport,
  onDoubleClick,
}: EventCardProps) {
  const [expanded, setExpanded] = useState(true);
  const clickTimerRef = { current: 0 as number | null };

  const handleCardClick = () => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      setExpanded((prev) => !prev);
      clickTimerRef.current = null;
    }, 250);
  };

  const handleDoubleClick = () => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onDoubleClick(event);
  };

  const gridCols =
    event.images.length === 1
      ? '1fr'
      : event.images.length === 2
      ? '1fr 1fr'
      : '1fr 1fr 1fr';

  return (
    <div
      style={{
        width: '800px',
        maxWidth: '100%',
        margin: '0 auto 32px',
        background: '#FFFFFF',
        borderRadius: '16px',
        boxShadow: isSelected
          ? '0 8px 24px rgba(74, 144, 217, 0.25)'
          : '0 2px 8px rgba(0, 0, 0, 0.08)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        position: 'relative',
        animation: `flyInFromBottom 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.1}s both`,
        cursor: 'pointer',
        border: isSelected ? '2px solid #4A90D9' : '2px solid transparent',
        willChange: 'transform, box-shadow',
      }}
      className="event-card-hover"
      onClick={handleCardClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        if (!isSelected) {
          el.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.15)';
        }
        el.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        if (!isSelected) {
          el.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
        }
        el.style.transform = 'translateY(0)';
      }}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleExport(event.id);
        }}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          width: '24px',
          height: '24px',
          borderRadius: '6px',
          border: isExportSelected ? 'none' : '2px solid #C8BEB5',
          background: isExportSelected ? '#4A90D9' : 'rgba(255,255,255,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          zIndex: 10,
          cursor: 'pointer',
        }}
        title={isExportSelected ? '取消选择导出' : '选择用于导出'}
      >
        {isExportSelected && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>

      <div style={{ padding: '20px 24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span style={{
            color: '#4A90D9',
            fontSize: '15px',
            fontWeight: 600,
            letterSpacing: '0.3px',
          }}>
            {formatDate(event.date)}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span style={{ color: '#2E7D32', fontSize: '15px', fontWeight: 600 }}>
              {event.country} · {event.location}
            </span>
          </div>
        </div>

        {event.tags.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {event.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  padding: '3px 10px',
                  background: '#F5F0EB',
                  borderRadius: '12px',
                  fontSize: '12px',
                  color: '#666',
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {event.images.length > 0 && expanded && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            gap: '2px',
            maxHeight: expanded ? '300px' : '0',
            overflow: 'hidden',
            transition: 'max-height 0.3s ease',
          }}
        >
          {event.images.map((img, i) => (
            <div key={i} style={{ height: '200px', overflow: 'hidden' }}>
              <LazyImage src={img} alt={`${event.location}-${i + 1}`} />
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          padding: expanded ? '0 24px 20px' : '0 24px 0',
          maxHeight: expanded ? '600px' : '0',
          overflow: 'hidden',
          transition: 'all 0.3s ease',
        }}
      >
        <p style={{
          color: '#333',
          fontSize: '14px',
          lineHeight: 1.6,
          marginTop: '16px',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {event.description}
        </p>
        <p style={{
          color: '#999',
          fontSize: '12px',
          marginTop: '8px',
          textAlign: 'center',
        }}>
          💡 双击卡片查看完整详情
        </p>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .event-card-hover {
          contain: layout paint;
        }
      `}</style>
    </div>
  );
}
