import { useApp } from '@/store/AppContext';
import { BOOKING_STATUS_LABELS, CATEGORY_COLORS, CATEGORY_LABELS } from '@/types';
import type { Booking } from '@/types';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { FiUser, FiStar, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  pending: '#2E8B57',
  active: '#FFD3B6',
  completed: '#A8E6CF',
  cancelled: '#B0B0B0',
};

function formatTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type RatingModalProps = {
  booking: Booking;
  onClose: () => void;
  onSubmit: (bookingId: string, rating: number, comment: string) => Promise<void>;
};

function RatingModal({ booking, onClose, onSubmit }: RatingModalProps) {
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [comment, setComment] = useState('');
  const [animating, setAnimating] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (stars === 0) {
      toast.error('请选择评分');
      return;
    }
    setAnimating(true);
    setTimeout(async () => {
      setAnimating(false);
      setSubmitted(true);
      await onSubmit(booking.id, stars, comment);
      toast.success('评价成功');
      onClose();
    }, 500);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose}>
          <FiX size={18} />
        </button>
        <h3 style={{ margin: 0, marginBottom: 16, fontSize: 18, fontWeight: 600 }}>
          评价预约
        </h3>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[1, 2, 3, 4, 5].map((i) => {
            const filled = i <= (hoverStars || stars);
            const delay = animating ? `${(i - 1) * 0.1}s` : '0s';
            return (
              <span
                key={i}
                onClick={() => !animating && setStars(i)}
                onMouseEnter={() => !animating && setHoverStars(i)}
                onMouseLeave={() => setHoverStars(0)}
                style={{
                  cursor: animating ? 'default' : 'pointer',
                  fontSize: 32,
                  color: filled ? '#F5A623' : '#ddd',
                  transition: 'color 0.15s',
                  animation: animating ? `starFlyIn 0.5s ${delay} ease-out both, starFlash 0.2s ${delay} ease-out` : 'none',
                  display: 'inline-block',
                }}
              >
                <FiStar
                  fill={filled ? '#F5A623' : 'none'}
                  stroke={filled ? '#F5A623' : '#ddd'}
                  style={{ verticalAlign: 'middle' }}
                  size={32}
                />
              </span>
            );
          })}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="写几句评价吧..."
          maxLength={200}
          disabled={animating}
          style={{
            width: '100%',
            height: 72,
            border: '1px solid #D4A574',
            borderRadius: 8,
            padding: 8,
            fontSize: 14,
            resize: 'none',
            marginBottom: 16,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={animating || submitted}
          style={{
            width: '100%',
            padding: '10px 0',
            border: 'none',
            borderRadius: 8,
            background: submitted ? '#ccc' : '#D4A574',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: animating || submitted ? 'default' : 'pointer',
          }}
        >
          {animating ? '提交中...' : '提交评价'}
        </button>
      </div>
    </div>
  );
}

export default function UserProfile() {
  const { bookings, spaces, currentUser, cancelBooking, rateBooking } = useApp();
  const navigate = useNavigate();
  const [ratingBooking, setRatingBooking] = useState<Booking | null>(null);
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());

  const userBookings = bookings
    .filter((b) => b.userId === currentUser.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const getSpaceName = (spaceId: string) => {
    const space = spaces.find((s) => s.id === spaceId);
    return space?.name ?? '未知空间';
  };

  const getSpaceCategory = (spaceId: string) => {
    const space = spaces.find((s) => s.id === spaceId);
    return space?.category;
  };

  const handleCancel = async (bookingId: string) => {
    setFadingIds((prev) => new Set(prev).add(bookingId));
    setTimeout(async () => {
      await cancelBooking(bookingId);
      setFadingIds((prev) => {
        const next = new Set(prev);
        next.delete(bookingId);
        return next;
      });
      toast.success('已取消预约');
    }, 400);
  };

  const handleRate = async (bookingId: string, rating: number, comment: string) => {
    await rateBooking(bookingId, rating, comment);
  };

  if (userBookings.length === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <FiUser size={20} />
          <span style={{ fontWeight: 600, fontSize: 18 }}>{currentUser.name} 的预约记录</span>
        </div>
        <div style={styles.empty}>
          <FiUser size={48} color="#D4A574" />
          <p style={{ color: '#888', marginTop: 12 }}>暂无预约记录</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes starFlyIn {
          0% { transform: translateX(-40px); opacity: 0; }
          60% { opacity: 1; }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes starFlash {
          0% { filter: brightness(1); }
          50% { filter: brightness(2); }
          100% { filter: brightness(1); }
        }
      `}</style>
      <div style={styles.header}>
        <FiUser size={20} />
        <span style={{ fontWeight: 600, fontSize: 18 }}>{currentUser.name} 的预约记录</span>
      </div>
      <div style={styles.cardList}>
        {userBookings.map((booking) => {
          const category = getSpaceCategory(booking.spaceId);
          const isFading = fadingIds.has(booking.id);
          return (
            <div
              key={booking.id}
              style={{
                ...styles.card,
                opacity: isFading ? 0 : 1,
                transform: isFading ? 'scale(0.95)' : 'scale(1)',
                transition: 'opacity 0.4s, transform 0.4s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
                    {getSpaceName(booking.spaceId)}
                  </div>
                  {category && (
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: CATEGORY_COLORS[category],
                        color: '#555',
                      }}
                    >
                      {CATEGORY_LABELS[category]}
                    </span>
                  )}
                </div>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 10,
                    background: STATUS_COLORS[booking.status],
                    color: booking.status === 'pending' ? '#fff' : '#333',
                  }}
                >
                  {BOOKING_STATUS_LABELS[booking.status]}
                </span>
              </div>

              <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
                {formatTime(booking.startTime)} ~ {formatTime(booking.endTime)}
              </div>

              {booking.purpose && (
                <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
                  用途：{booking.purpose}
                </div>
              )}

              {booking.rating !== undefined && (
                <div style={{ fontSize: 13, color: '#F5A623', marginBottom: 8 }}>
                  {'★'.repeat(booking.rating)}{'☆'.repeat(5 - booking.rating)}
                  {booking.comment && <span style={{ color: '#888', marginLeft: 6 }}>{booking.comment}</span>}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                {booking.status === 'completed' && booking.rating === undefined && (
                  <button
                    onClick={() => setRatingBooking(booking)}
                    style={styles.actionBtn}
                  >
                    <FiStar size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    评价
                  </button>
                )}
                {booking.status === 'pending' && (
                  <button
                    onClick={() => handleCancel(booking.id)}
                    style={{ ...styles.actionBtn, background: '#e74c3c' }}
                  >
                    <FiX size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    取消
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {ratingBooking && (
        <RatingModal
          booking={ratingBooking}
          onClose={() => setRatingBooking(null)}
          onSubmit={handleRate}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 800,
    margin: '0 auto',
    padding: '24px 16px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  cardList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
  },
  card: {
    background: '#F5E6CC',
    border: '1px solid #D4A574',
    borderRadius: 12,
    padding: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    flex: '1 1 320px',
    minWidth: 280,
  },
  actionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    border: 'none',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    background: '#D4A574',
    color: '#fff',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 0',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.3)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: 16,
    padding: 28,
    width: '90%',
    maxWidth: 380,
    position: 'relative',
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    color: '#888',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
