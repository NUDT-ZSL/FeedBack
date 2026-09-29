import React from 'react';
import { WorkStep } from '../types';
import { FaClock } from 'react-icons/fa';

interface StepCardProps {
  step: WorkStep;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  draggable?: boolean;
  showConnector?: boolean;
}

export const StepCard: React.FC<StepCardProps> = ({
  step,
  isDragging = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggable = false,
  showConnector = true,
}) => {
  return (
    <div style={{ position: 'relative', marginBottom: showConnector ? '40px' : '0' }}>
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-card)',
          boxShadow: isDragging
            ? '0 16px 48px rgba(0,0,0,0.2)'
            : 'var(--shadow-card)',
          padding: 'var(--padding-card)',
          transform: isDragging ? 'rotate(2deg) scale(1.05)' : 'none',
          transition: 'transform 0.2s var(--easing-standard), box-shadow 0.2s var(--easing-standard)',
          cursor: draggable ? 'grab' : 'default',
          position: 'relative',
          zIndex: isDragging ? 10 : 1,
        }}
      >
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--connector-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: '18px',
              flexShrink: 0,
            }}
          >
            {step.order}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <img
              src={step.image}
              alt={`步骤 ${step.order}`}
              loading="lazy"
              style={{
                width: '100%',
                height: '200px',
                objectFit: 'cover',
                borderRadius: '12px',
                marginBottom: '16px',
              }}
            />
            <p style={{ color: 'var(--text-body)', marginBottom: '12px', lineHeight: 1.7 }}>
              {step.description}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '14px' }}>
              <FaClock size={14} />
              <span>{step.duration} 分钟</span>
            </div>
          </div>
        </div>
      </div>

      {showConnector && (
        <div
          style={{
            position: 'absolute',
            left: '47px',
            top: '100%',
            width: '2px',
            height: '40px',
            backgroundImage: 'radial-gradient(circle, var(--connector-color) 1px, transparent 1px)',
            backgroundSize: '2px 8px',
          }}
        />
      )}
    </div>
  );
};
