import React, { useRef, useState } from 'react';
import { useStar } from '../context/StarContext';
import { SHICHEN, SHICHEN_HOURS } from '../types';

const ShichenController: React.FC = () => {
  const { currentHour, setCurrentHour } = useStar();
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const calculateHourFromPosition = (clientX: number, clientY: number): number => {
    if (!containerRef.current) return currentHour;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    const hour = (angle / 360) * 24;
    return Math.round(hour * 2) / 2;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const hour = calculateHourFromPosition(e.clientX, e.clientY);
    setCurrentHour(hour);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const hour = calculateHourFromPosition(e.clientX, e.clientY);
    setCurrentHour(hour);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const shichenIndex = Math.floor((currentHour + 1) / 2) % 12;
  const displayHour = Math.floor(currentHour) % 24;
  const displayMin = Math.floor((currentHour % 1) * 60);

  const pointerAngle = (currentHour / 24) * 360;

  return (
    <div
      style={{
        position: 'fixed',
        right: '280px',
        top: '20px',
        width: '180px',
        zIndex: 50,
      }}
    >
      <div style={{
        textAlign: 'center',
        marginBottom: '8px',
        color: '#ffd700',
        fontSize: '14px',
        textShadow: '0 0 10px rgba(255, 215, 0, 0.5)',
      }}>
        观测时辰
      </div>

      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0, 0, 0, 0.6) 0%, rgba(13, 2, 33, 0.8) 100%)',
          border: '2px solid rgba(255, 215, 0, 0.5)',
          boxShadow: '0 0 20px rgba(255, 215, 0, 0.2), inset 0 0 30px rgba(0, 0, 0, 0.5)',
          position: 'relative',
          cursor: 'pointer',
          transition: 'box-shadow 0.3s ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.boxShadow = '0 0 30px rgba(255, 215, 0, 0.4), inset 0 0 30px rgba(0, 0, 0, 0.5)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 215, 0, 0.2), inset 0 0 30px rgba(0, 0, 0, 0.5)';
        }}
      >
        {SHICHEN.map((char, i) => {
          const angle = (i * 30 - 90) * (Math.PI / 180);
          const radius = 70;
          const x = 90 + radius * Math.cos(angle);
          const y = 90 + radius * Math.sin(angle);
          const isCurrent = i === shichenIndex;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                transform: 'translate(-50%, -50%)',
                fontSize: isCurrent ? '18px' : '14px',
                fontWeight: isCurrent ? 700 : 400,
                color: isCurrent ? '#ffd700' : '#c0a060',
                textShadow: isCurrent ? '0 0 10px rgba(255, 215, 0, 0.8)' : 'none',
                transition: 'all 0.3s ease',
                fontFamily: "'Noto Serif SC', serif",
                userSelect: 'none',
              }}
            >
              {char}
            </div>
          );
        })}

        {SHICHEN_HOURS.map((hour, i) => {
          const angle = (i * 30 - 90) * (Math.PI / 180);
          const radius = 50;
          const x = 90 + radius * Math.cos(angle);
          const y = 90 + radius * Math.sin(angle);
          return (
            <div
              key={`h-${i}`}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                transform: 'translate(-50%, -50%)',
                fontSize: '10px',
                color: 'rgba(192, 160, 96, 0.6)',
                fontFamily: 'monospace',
                userSelect: 'none',
              }}
            >
              {hour.toString().padStart(2, '0')}
            </div>
          );
        })}

        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '3px',
            height: '60px',
            background: 'linear-gradient(180deg, #ffd700 0%, rgba(255, 215, 0, 0.3) 100%)',
            transformOrigin: 'bottom center',
            transform: `translate(-50%, -100%) rotate(${pointerAngle}deg)`,
            transition: 'transform 2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div style={{
            position: 'absolute',
            top: '-8px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: '12px solid #ffd700',
            filter: 'drop-shadow(0 0 5px rgba(255, 215, 0, 0.8))',
          }} />
        </div>

        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, #ffd700 0%, #b8860b 100%)',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 10px rgba(255, 215, 0, 0.8)',
        }} />

        <div style={{
          position: 'absolute',
          bottom: '15px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '11px',
          color: '#c0a060',
          fontFamily: 'monospace',
        }}>
          {displayHour.toString().padStart(2, '0')}:{displayMin.toString().padStart(2, '0')}
        </div>
      </div>
    </div>
  );
};

export default ShichenController;
