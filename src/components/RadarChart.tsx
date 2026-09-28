import React, { useState, useRef, useEffect, useMemo } from 'react';
import { RadarDimension } from '@/utils/helpers';

interface RadarChartProps {
  data: RadarDimension[];
  width?: number;
  height?: number;
}

export const RadarChart: React.FC<RadarChartProps> = ({
  data,
  width = 500,
  height = 500
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; visible: boolean; name: string; value: number }>({
    x: 0, y: 0, visible: false, name: '', value: 0
  });
  const svgRef = useRef<SVGSVGElement>(null);

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 60;
  const levels = 5;

  const angles = useMemo(() => {
    return data.map((_, i) => (Math.PI * 2 * i) / data.length - Math.PI / 2);
  }, [data.length]);

  const getPointPosition = (index: number, value: number, fullMark: number) => {
    const angle = angles[index];
    const r = (value / fullMark) * radius * scale;
    return {
      x: centerX + Math.cos(angle) * r,
      y: centerY + Math.sin(angle) * r
    };
  };

  const dataPoints = useMemo(() => {
    return data.map((d, i) => getPointPosition(i, d.value, d.fullMark));
  }, [data, angles, scale]);

  const polygonPoints = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale(prev => Math.max(0.5, Math.min(2, prev + delta)));
  };

  const handlePointHover = (index: number, event: React.MouseEvent) => {
    setHoveredIndex(index);
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltip({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top - 10,
        visible: true,
        name: data[index].name,
        value: data[index].value
      });
    }
  };

  const handlePointLeave = () => {
    setHoveredIndex(null);
    setTooltip(prev => ({ ...prev, visible: false }));
  };

  const gridLevels = Array.from({ length: levels }, (_, i) => i + 1);

  return (
    <div
      style={{
        position: 'relative',
        width: `${width}px`,
        height: `${height}px`
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onWheel={handleWheel}
        style={{ cursor: 'grab' }}
      >
        <defs>
          <linearGradient id="radarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00b4d8" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#e63946" stopOpacity="0.6" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {gridLevels.map(level => {
          const r = (radius * level * scale) / levels;
          const points = angles.map(angle => ({
            x: centerX + Math.cos(angle) * r,
            y: centerY + Math.sin(angle) * r
          }));
          return (
            <polygon
              key={level}
              points={points.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="rgba(255, 255, 255, 0.1)"
              strokeWidth="1"
            />
          );
        })}

        {angles.map((angle, i) => {
          const endX = centerX + Math.cos(angle) * radius * scale;
          const endY = centerY + Math.sin(angle) * radius * scale;
          return (
            <line
              key={i}
              x1={centerX}
              y1={centerY}
              x2={endX}
              y2={endY}
              stroke="rgba(255, 255, 255, 0.15)"
              strokeWidth="1"
            />
          );
        })}

        <polygon
          points={polygonPoints}
          fill="url(#radarGradient)"
          fillOpacity="0.3"
          stroke="#00b4d8"
          strokeWidth="2"
          filter="url(#glow)"
          style={{ transition: 'all 0.3s ease' }}
        />

        {dataPoints.map((point, i) => (
          <circle
            key={i}
            cx={point.x}
            cy={point.y}
            r={hoveredIndex === i ? 8 : 5}
            fill={hoveredIndex === i ? '#e63946' : '#00b4d8'}
            stroke="#fff"
            strokeWidth="2"
            style={{
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              filter: 'url(#glow)'
            }}
            onMouseEnter={(e) => handlePointHover(i, e)}
            onMouseLeave={handlePointLeave}
          />
        ))}

        {data.map((d, i) => {
          const angle = angles[i];
          const labelRadius = radius * scale + 25;
          const x = centerX + Math.cos(angle) * labelRadius;
          const y = centerY + Math.sin(angle) * labelRadius;
          return (
            <text
              key={i}
              x={x}
              y={y}
              fill="rgba(255, 255, 255, 0.8)"
              fontSize="14"
              fontWeight="500"
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="'Inter', sans-serif"
            >
              {d.name}
            </text>
          );
        })}
      </svg>

      {tooltip.visible && (
        <div
          style={{
            position: 'absolute',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translate(-50%, -100%)',
            backgroundColor: 'rgba(26, 26, 46, 0.95)',
            border: '1px solid #00b4d8',
            borderRadius: '8px',
            padding: '8px 12px',
            color: '#fff',
            fontSize: '13px',
            pointerEvents: 'none',
            boxShadow: '0 0 15px rgba(0, 180, 216, 0.3)',
            whiteSpace: 'nowrap',
            zIndex: 10
          }}
        >
          <div style={{ fontWeight: 600, color: '#00b4d8' }}>{tooltip.name}</div>
          <div style={{ marginTop: '4px' }}>
            数值: <span style={{ color: '#e63946', fontWeight: 600 }}>{tooltip.value}</span> / 100
          </div>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: '12px'
        }}
      >
        缩放: {Math.round(scale * 100)}%
      </div>
    </div>
  );
};
