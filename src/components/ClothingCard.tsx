import React from 'react';
import { ClothingItem, CATEGORY_COLORS, CATEGORY_LABELS } from '../types';
import { Shirt, Pants, Coat, Footprints, Sparkles, Trash2 } from 'lucide-react';

interface ClothingCardProps {
  item: ClothingItem;
  onDelete?: (id: string) => void;
  selected?: boolean;
  onClick?: () => void;
}

const categoryIcons: Record<string, React.ReactNode> = {
  top: <Shirt size={24} />,
  bottom: <Pants size={24} />,
  outerwear: <Coat size={24} />,
  shoes: <Footprints size={24} />,
  accessory: <Sparkles size={24} />,
};

export const ClothingCard: React.FC<ClothingCardProps> = ({
  item,
  onDelete,
  selected = false,
  onClick,
}) => {
  const categoryColor = CATEGORY_COLORS[item.category];

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(item.id);
    }
  };

  return (
    <div
      className={`clothing-card ${selected ? 'selected' : ''}`}
      onClick={onClick}
      style={{
        backgroundColor: 'var(--color-white)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform var(--transition-normal), box-shadow var(--transition-normal)',
        position: 'relative',
        border: selected ? '2px solid var(--color-accent)' : '2px solid transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-8px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      {onDelete && (
        <button
          className="delete-btn"
          onClick={handleDelete}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-light)',
            opacity: 0,
            transition: 'opacity var(--transition-fast)',
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = 'var(--color-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0';
            e.currentTarget.style.color = 'var(--color-text-light)';
          }}
        >
          <Trash2 size={16} />
        </button>
      )}

      <div
        className="category-header"
        style={{
          backgroundColor: categoryColor,
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          height: '80px',
        }}
      >
        {categoryIcons[item.category]}
        <span style={{ marginLeft: '8px', fontWeight: 500 }}>
          {CATEGORY_LABELS[item.category]}
        </span>
      </div>

      <div
        className="color-section"
        style={{
          height: '60px',
          backgroundColor: item.color,
          borderBottom: '1px solid var(--color-border)',
          position: 'relative',
        }}
      >
        {item.photoUrl && (
          <img
            src={item.photoUrl}
            alt={item.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
      </div>

      <div
        className="card-body"
        style={{
          padding: '12px',
        }}
      >
        <h3
          style={{
            fontSize: '14px',
            fontWeight: 600,
            marginBottom: '8px',
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </h3>

        <div
          className="style-tags"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
          }}
        >
          {item.styleTags.map((tag) => (
            <span
              key={tag}
              className="style-tag"
              style={{
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                backgroundColor: 'var(--color-secondary)',
                color: 'var(--color-text)',
                transition: 'all var(--transition-fast)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
