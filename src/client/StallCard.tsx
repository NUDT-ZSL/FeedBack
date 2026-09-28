import React from 'react';

interface StallListItem {
  id: string;
  name: string;
  description: string;
  photoUrl: string;
  category: string;
  businessHoursStart: number;
  businessHoursEnd: number;
  maxReservations: number;
  totalSlots: number;
  availableSlots: number;
}

interface StallCardProps {
  stall: StallListItem;
  onClick: () => void;
}

const COLORS = {
  cardBg: '#FFFAF3',
  primary: '#6F4E37',
  secondary: '#C4724A',
  accent: '#D4A574',
  text: '#3E2723',
  textLight: '#8D6E63',
  border: '#E8DDD3',
  success: '#4CAF50',
};

function StallCard({ stall, onClick }: StallCardProps) {
  return (
    <div
      onClick={onClick}
      className="stall-card"
      style={{
        background: COLORS.cardBg,
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(111,78,55,0.08)',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease',
        border: `1px solid ${COLORS.border}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-5px)';
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(111,78,55,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(111,78,55,0.08)';
      }}
    >
      <div style={{ width: '100%', height: 180, overflow: 'hidden', position: 'relative' }}>
        <img
          src={stall.photoUrl}
          alt={stall.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform 0.3s ease',
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180" fill="%23E8DDD3"><rect width="400" height="180"/><text x="200" y="95" text-anchor="middle" fill="%238D6E63" font-size="18">🎪</text></svg>');
          }}
          onMouseEnter={(e) => { (e.target as HTMLImageElement).style.transform = 'scale(1.05)'; }}
          onMouseLeave={(e) => { (e.target as HTMLImageElement).style.transform = 'scale(1)'; }}
        />
        <span style={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: COLORS.secondary,
          color: '#fff',
          padding: '3px 10px',
          borderRadius: 16,
          fontSize: 11,
          fontWeight: 600,
        }}>
          {stall.category}
        </span>
      </div>
      <div style={{ padding: '14px 16px' }}>
        <h3 style={{
          fontSize: 16,
          fontWeight: 600,
          color: COLORS.primary,
          marginBottom: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {stall.name}
        </h3>
        <p style={{
          fontSize: 13,
          color: COLORS.textLight,
          lineHeight: 1.5,
          marginBottom: 10,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {stall.description}
        </p>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 12,
        }}>
          <span style={{ color: COLORS.textLight }}>
            🕐 {stall.businessHoursStart}:00-{stall.businessHoursEnd}:00
          </span>
          <span style={{
            color: stall.availableSlots > 0 ? COLORS.success : '#E53935',
            fontWeight: 600,
            fontSize: 12,
          }}>
            {stall.availableSlots > 0 ? `余 ${stall.availableSlots} 时段` : '已约满'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default StallCard;
