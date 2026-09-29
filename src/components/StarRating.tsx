import React, { useState } from 'react';
import { FaStar } from 'react-icons/fa';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readonly?: boolean;
  size?: number;
}

export const StarRating: React.FC<StarRatingProps> = ({
  value,
  onChange,
  readonly = false,
  size = 20,
}) => {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const handleClick = (index: number) => {
    if (!readonly && onChange) {
      onChange(index + 1);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
      {[0, 1, 2, 3, 4].map((index) => {
        const isFilled = (hoverValue ?? value) > index;
        return (
          <FaStar
            key={index}
            size={size}
            color={isFilled ? '#FFD700' : '#E0E0E0'}
            style={{
              cursor: readonly ? 'default' : 'pointer',
              transition: 'transform 0.2s ease-out',
              userSelect: 'none',
            }}
            onMouseEnter={() => !readonly && setHoverValue(index + 1)}
            onMouseLeave={() => !readonly && setHoverValue(null)}
            onClick={() => handleClick(index)}
            onMouseDown={(e) => {
              if (!readonly) {
                e.currentTarget.style.transform = 'scale(1.15)';
              }
            }}
            onMouseUp={(e) => {
              if (!readonly) {
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          />
        );
      })}
      {readonly && (
        <span style={{ marginLeft: '4px', fontSize: '14px', color: 'var(--text-muted)' }}>
          {value.toFixed(1)}
        </span>
      )}
    </div>
  );
};
