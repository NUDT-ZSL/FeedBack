import React, { useState } from 'react';

export interface IconItem {
  id: string;
  name: string;
  svgDataUrl: string;
  width: number;
  height: number;
  selected: boolean;
  loading?: boolean;
}

interface IconCardProps {
  icon: IconItem;
  index: number;
  draggable?: boolean;
  onToggleSelect: (id: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onDragEnter: (index: number) => void;
  isDragging?: boolean;
  dragOverIndex?: number | null;
}

const IconCard: React.FC<IconCardProps> = ({
  icon,
  index,
  draggable = true,
  onToggleSelect,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragEnter,
  isDragging,
  dragOverIndex,
}) => {
  const isDragOverThis = dragOverIndex === index;

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onDragEnter={() => onDragEnter(index)}
      style={{
        width: '140px',
        background: '#2d2d2d',
        borderRadius: '8px',
        padding: '12px',
        border: icon.selected ? '2px solid #00d4aa' : '2px solid transparent',
        cursor: draggable ? 'grab' : 'default',
        opacity: isDragging ? 0.5 : 1,
        transform: isDragOverThis && !isDragging ? 'translateY(4px)' : 'translateY(0)',
        transition: 'transform 0.2s ease, border-color 0.2s ease, opacity 0.3s ease-in-out',
        animation: 'fadeIn 0.3s ease-in-out',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          width: '18px',
          height: '18px',
          cursor: 'pointer',
          zIndex: 2,
        }}
        onClick={() => onToggleSelect(icon.id)}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '4px',
            border: icon.selected ? '2px solid #00d4aa' : '2px solid #666',
            background: icon.selected ? '#00d4aa' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
        >
          {icon.selected && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6L5 9L10 3" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>

      <div
        style={{
          width: '80px',
          height: '80px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '6px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {icon.loading ? (
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              border: '3px solid rgba(0,212,170,0.2)',
              borderTopColor: '#00d4aa',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        ) : (
          <img
            src={icon.svgDataUrl}
            alt={icon.name}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        )}
      </div>

      <div
        style={{
          fontSize: '12px',
          color: '#e0e0e0',
          textAlign: 'center',
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 500,
        }}
        title={icon.name}
      >
        {icon.name}
      </div>
      <div style={{ fontSize: '11px', color: '#888' }}>
        {icon.width} × {icon.height} px
      </div>
    </div>
  );
};

export default IconCard;
