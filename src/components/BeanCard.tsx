import React, { useState } from 'react';
import { CoffeeBean, ROAST_COLORS } from '../types';

interface BeanCardProps {
  bean: CoffeeBean;
  onClick: () => void;
}

const BeanCard: React.FC<BeanCardProps> = React.memo(({ bean, onClick }) => {
  const [isExpanding, setIsExpanding] = useState(false);
  const colors = ROAST_COLORS[bean.roastLevel];

  const handleClick = () => {
    setIsExpanding(true);
    setTimeout(() => {
      onClick();
      setIsExpanding(false);
    }, 400);
  };

  const cardStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, ${colors.start}, ${colors.end})`,
    borderRadius: '12px',
    padding: '24px',
    cursor: 'pointer',
    transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease',
    transform: isExpanding ? 'scale(1.05)' : 'scale(1)',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    minHeight: '140px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  };

  return (
    <div
      style={cardStyle}
      onClick={handleClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = isExpanding ? 'scale(1.05)' : 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = isExpanding ? 'scale(1.05)' : 'scale(1)';
        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
      }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#3E2723' }}>
          {bean.name}
        </h3>
        <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: '#5D4037' }}>
          {bean.origin}
        </p>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
        <span style={{
          backgroundColor: 'rgba(255, 255, 255, 0.5)',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '12px',
          color: '#3E2723',
        }}>
          {bean.processMethod}
        </span>
        <span style={{
          backgroundColor: 'rgba(255, 255, 255, 0.5)',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '12px',
          color: '#3E2723',
        }}>
          {bean.roastLevel}焙
        </span>
      </div>
    </div>
  );
});

BeanCard.displayName = 'BeanCard';

export default BeanCard;
