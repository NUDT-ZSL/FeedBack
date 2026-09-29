import { useApp } from '@/store/AppContext';
import { CATEGORY_COLORS, CATEGORY_LABELS, STATUS_LABELS } from '@/types';
import type { Space, Activity } from '@/types';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { FiMapPin } from 'react-icons/fi';

export default function MapView() {
  const { spaces, activities, bookings, currentUser, loading } = useApp();
  const navigate = useNavigate();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isCardLayout = windowWidth < 1024;

  const interestingActivities = activities.filter((a) => a.interestingCount > 0);

  const userBookings = bookings.filter((b) => b.userId === currentUser?.id);
  const showCarousel = userBookings.length === 0 && interestingActivities.length > 0;

  useEffect(() => {
    if (!showCarousel || interestingActivities.length <= 1) return;
    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % interestingActivities.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [showCarousel, interestingActivities.length]);

  const handleSpaceClick = useCallback(
    (spaceId: string) => {
      navigate(`/space/${spaceId}`);
    },
    [navigate],
  );

  const handleActivityClick = useCallback(
    (spaceId: string) => {
      navigate(`/space/${spaceId}`);
    },
    [navigate],
  );

  if (loading) {
    return <div style={styles.loading}>加载中...</div>;
  }

  const currentActivity =
    showCarousel && interestingActivities.length > 0
      ? interestingActivities[carouselIndex % interestingActivities.length]
      : null;

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes carouselSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {showCarousel && currentActivity && (
        <div
          style={styles.carouselBar}
          onClick={() => handleActivityClick(currentActivity.spaceId)}
        >
          <FiMapPin size={14} style={{ flexShrink: 0, color: '#D4A574' }} />
          <div key={carouselIndex} style={{ animation: 'carouselSlideIn 0.4s ease' }}>
            {currentActivity.time}在{currentActivity.spaceName}有{currentActivity.title}，标记为有意思
            {currentActivity.interestingCount}人
          </div>
        </div>
      )}

      {isCardLayout ? (
        <div style={styles.cardList}>
          {spaces.map((space) => {
            const isHovered = hoveredId === space.id;
            return (
              <div
                key={space.id}
                style={{
                  ...styles.card,
                  transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                  boxShadow: isHovered
                    ? '0 4px 14px rgba(0,0,0,0.12)'
                    : '0 2px 8px rgba(0,0,0,0.06)',
                }}
                onClick={() => handleSpaceClick(space.id)}
                onMouseEnter={() => setHoveredId(space.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      background: CATEGORY_COLORS[space.category],
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{space.name}</span>
                </div>
                <div style={{ fontSize: 13, color: '#666' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: 12,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: CATEGORY_COLORS[space.category],
                      color: '#555',
                      marginRight: 8,
                    }}
                  >
                    {CATEGORY_LABELS[space.category]}
                  </span>
                  <span>{STATUS_LABELS[space.status]}</span>
                  <span style={{ marginLeft: 12 }}>近半小时 {space.recentUsers} 人</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={styles.mapContainer}>
          {spaces.map((space) => {
            const isHovered = hoveredId === space.id;
            return (
              <div
                key={space.id}
                style={{
                  ...styles.mapBlock,
                  left: `${space.position.x}%`,
                  top: `${space.position.y}%`,
                  background: CATEGORY_COLORS[space.category],
                  transform: `translate(-50%, -50%) scale(${isHovered ? 1.06 : 1})`,
                  boxShadow: isHovered
                    ? '0 4px 14px rgba(0,0,0,0.2)'
                    : '0 2px 6px rgba(0,0,0,0.12)',
                }}
                onClick={() => handleSpaceClick(space.id)}
                onMouseEnter={() => setHoveredId(space.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: '#444' }}>{space.name}</span>
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    marginBottom: 8,
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.72)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    borderRadius: 10,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                    whiteSpace: 'nowrap',
                    transition: 'opacity 0.2s ease, transform 0.2s ease',
                    zIndex: 10,
                    opacity: isHovered ? 1 : 0,
                    transform: `translateX(-50%) translateY(${isHovered ? 0 : 8}px)`,
                    pointerEvents: isHovered ? 'auto' : 'none',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{space.name}</div>
                  <div style={{ fontSize: 12, color: '#555' }}>状态：{STATUS_LABELS[space.status]}</div>
                  <div style={{ fontSize: 12, color: '#555' }}>近半小时：{space.recentUsers} 人</div>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -6,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 0,
                      height: 0,
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '6px solid rgba(255,255,255,0.72)',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '24px 16px',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
    color: '#888',
    fontSize: 15,
  },
  carouselBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    marginBottom: 16,
    background: 'rgba(255,255,255,0.75)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 10,
    cursor: 'pointer',
    fontSize: 13,
    color: '#555',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  mapContainer: {
    position: 'relative',
    width: '100%',
    height: 500,
    backgroundColor: '#F5E6CC',
    backgroundImage:
      'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)',
    backgroundSize: '24px 24px',
    borderRadius: 12,
    border: '1px solid #D4A574',
    overflow: 'visible',
  },
  mapBlock: {
    position: 'absolute',
    minWidth: 80,
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'box-shadow 0.2s, transform 0.2s',
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  card: {
    background: '#F5E6CC',
    border: '1px solid #D4A574',
    borderRadius: 12,
    padding: 16,
    cursor: 'pointer',
    transition: 'box-shadow 0.2s, transform 0.15s',
  },
};
