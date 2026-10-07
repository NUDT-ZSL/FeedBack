import React, { useState, useCallback } from 'react';
import { Herb, DragState } from './types';
import { HERBS, ELEMENT_COLORS } from './constants';
import { audioManager } from './audio';

interface HerbCabinetProps {
  onDragStart: (herb: Herb, e: React.MouseEvent) => void;
  onDragEnd: () => void;
  dragState: DragState;
  onHerbUsed: (herbId: string) => void;
  herbCounts: Record<string, number>;
}

const HerbCabinet: React.FC<HerbCabinetProps> = ({
  onDragStart,
  onDragEnd,
  dragState,
  onHerbUsed,
  herbCounts
}) => {
  const [hoveredHerb, setHoveredHerb] = useState<string | null>(null);

  const handleMouseDown = useCallback((herb: Herb, e: React.MouseEvent) => {
    e.preventDefault();
    audioManager.resume();
    audioManager.playClickSound();
    onDragStart(herb, e);
  }, [onDragStart]);

  const renderHerbShape = (herb: Herb, size: number = 30) => {
    const s = size;
    switch (herb.shape) {
      case 'mushroom':
        return (
          <g>
            <ellipse cx={s/2} cy={s*0.6} rx={s*0.35} ry={s*0.25} fill={herb.color} />
            <ellipse cx={s/2} cy={s*0.4} rx={s*0.4} ry={s*0.3} fill={herb.color} />
            <rect x={s*0.45} y={s*0.55} width={s*0.1} height={s*0.35} fill="#8b7355" rx={2} />
            <ellipse cx={s*0.35} cy={s*0.35} rx={s*0.05} ry={s*0.03} fill="rgba(255,255,255,0.4)" />
          </g>
        );
      case 'root':
        return (
          <g>
            <path
              d={`M${s*0.5},${s*0.15} Q${s*0.6},${s*0.4} ${s*0.55},${s*0.7} Q${s*0.5},${s*0.85} ${s*0.4},${s*0.9} Q${s*0.3},${s*0.85} ${s*0.35},${s*0.7} Q${s*0.3},${s*0.4} ${s*0.5},${s*0.15}`}
              fill={herb.color}
            />
            <path
              d={`M${s*0.5},${s*0.2} L${s*0.3},${s*0.35} M${s*0.5},${s*0.4} L${s*0.25},${s*0.5} M${s*0.5},${s*0.6} L${s*0.3},${s*0.7}`}
              stroke="rgba(0,0,0,0.2)"
              strokeWidth="1"
              fill="none"
            />
          </g>
        );
      case 'crystal':
        return (
          <g>
            <polygon
              points={`${s*0.5},${s*0.1} ${s*0.75},${s*0.35} ${s*0.65},${s*0.85} ${s*0.35},${s*0.85} ${s*0.25},${s*0.35}`}
              fill={herb.color}
            />
            <polygon
              points={`${s*0.5},${s*0.1} ${s*0.65},${s*0.35} ${s*0.5},${s*0.5} ${s*0.35},${s*0.35}`}
              fill="rgba(255,255,255,0.3)"
            />
            <line x1={s*0.5} y1={s*0.5} x2={s*0.55} y2={s*0.85} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
          </g>
        );
      case 'powder':
        return (
          <g>
            <ellipse cx={s*0.5} cy={s*0.65} rx={s*0.35} ry={s*0.15} fill={herb.color} />
            <ellipse cx={s*0.45} cy={s*0.6} rx={s*0.3} ry={s*0.12} fill={herb.color} opacity="0.8" />
            <circle cx={s*0.3} cy={s*0.5} r={s*0.04} fill={herb.color} />
            <circle cx={s*0.6} cy={s*0.45} r={s*0.03} fill={herb.color} />
            <circle cx={s*0.7} cy={s*0.55} r={s*0.05} fill={herb.color} />
          </g>
        );
      case 'stone':
        return (
          <g>
            <ellipse cx={s*0.5} cy={s*0.55} rx={s*0.32} ry={s*0.28} fill={herb.color} />
            <ellipse cx={s*0.42} cy={s*0.45} rx={s*0.1} ry={s*0.07} fill="rgba(255,255,255,0.25)" />
            <path
              d={`M${s*0.35},${s*0.5} Q${s*0.5},${s*0.6} ${s*0.65},${s*0.55}`}
              stroke="rgba(0,0,0,0.15)"
              strokeWidth="1"
              fill="none"
            />
          </g>
        );
      case 'leaf':
        return (
          <g>
            <path
              d={`M${s*0.5},${s*0.15} Q${s*0.75},${s*0.35} ${s*0.7},${s*0.6} Q${s*0.6},${s*0.85} ${s*0.5},${s*0.9} Q${s*0.4},${s*0.85} ${s*0.3},${s*0.6} Q${s*0.25},${s*0.35} ${s*0.5},${s*0.15}`}
              fill={herb.color}
            />
            <line x1={s*0.5} y1={s*0.15} x2={s*0.5} y2={s*0.9} stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
            <line x1={s*0.5} y1={s*0.35} x2={s*0.35} y2={s*0.45} stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />
            <line x1={s*0.5} y1={s*0.35} x2={s*0.65} y2={s*0.45} stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />
            <line x1={s*0.5} y1={s*0.55} x2={s*0.38} y2={s*0.65} stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />
            <line x1={s*0.5} y1={s*0.55} x2={s*0.62} y2={s*0.65} stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />
          </g>
        );
      default:
        return <circle cx={s/2} cy={s/2} r={s*0.35} fill={herb.color} />;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>药柜</span>
        <span style={styles.subtitle}>本草纲目</span>
      </div>
      <div style={styles.grid}>
        {HERBS.map((herb, index) => {
          const count = herbCounts[herb.id] || 0;
          const isHovered = hoveredHerb === herb.id;
          const isDragging = dragState.isDragging && dragState.herb?.id === herb.id;
          
          return (
            <div
              key={herb.id}
              style={{
                ...styles.cell,
                transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                boxShadow: isHovered 
                  ? `0 0 15px ${ELEMENT_COLORS[herb.element]}, inset 0 0 10px rgba(255,255,255,0.2)`
                  : 'inset 0 2px 5px rgba(0,0,0,0.3)',
                opacity: count > 0 ? 1 : 0.4,
                cursor: count > 0 ? 'grab' : 'not-allowed'
              }}
              onMouseEnter={() => setHoveredHerb(herb.id)}
              onMouseLeave={() => setHoveredHerb(null)}
              onMouseDown={(e) => count > 0 && handleMouseDown(herb, e)}
              onMouseUp={onDragEnd}
            >
              <svg width="50" height="50" viewBox="0 0 50 50" style={styles.herbSvg}>
                {renderHerbShape(herb, 50)}
              </svg>
              <div style={styles.elementIndicator}>
                <div 
                  style={{
                    ...styles.elementDot,
                    backgroundColor: ELEMENT_COLORS[herb.element]
                  }}
                />
              </div>
              <div style={styles.countBadge}>
                {count}
              </div>
              
              {isHovered && (
                <div style={styles.tooltip}>
                  <div style={styles.tooltipName}>{herb.name}</div>
                  <div style={styles.tooltipElement}>
                    <span style={{ color: ELEMENT_COLORS[herb.element] }}>●</span>
                    {herb.element === 'wood' && '木属性'}
                    {herb.element === 'fire' && '火属性'}
                    {herb.element === 'earth' && '土属性'}
                    {herb.element === 'metal' && '金属性'}
                    {herb.element === 'water' && '水属性'}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {dragState.isDragging && dragState.herb && (
        <div
          style={{
            ...styles.draggingHerb,
            left: dragState.currentX - 30,
            top: dragState.currentY - 30,
            pointerEvents: 'none'
          }}
        >
          <svg width="60" height="60" viewBox="0 0 60 60">
            {renderHerbShape(dragState.herb, 60)}
          </svg>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    left: '20px',
    top: '50%',
    transform: 'translateY(-50%)',
    width: '320px',
    padding: '20px',
    background: 'linear-gradient(145deg, #3d2817, #2a1a0e)',
    border: '3px solid #6b4c3a',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)',
    zIndex: 10
  },
  header: {
    textAlign: 'center',
    marginBottom: '15px',
    paddingBottom: '10px',
    borderBottom: '2px solid #6b4c3a'
  },
  title: {
    display: 'block',
    fontSize: '28px',
    color: '#d4ac0d',
    fontFamily: "'Ma Shan Zheng', cursive",
    textShadow: '2px 2px 4px rgba(0,0,0,0.5)'
  },
  subtitle: {
    display: 'block',
    fontSize: '14px',
    color: '#8b7355',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    marginTop: '4px'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gridTemplateRows: 'repeat(3, 1fr)',
    gap: '8px'
  },
  cell: {
    position: 'relative',
    width: '45px',
    height: '45px',
    background: 'linear-gradient(145deg, #4a3728, #3d2817)',
    border: '2px solid #5c4033',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    userSelect: 'none'
  },
  herbSvg: {
    filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.5))'
  },
  elementIndicator: {
    position: 'absolute',
    top: '2px',
    right: '2px'
  },
  elementDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    boxShadow: '0 0 4px currentColor'
  },
  countBadge: {
    position: 'absolute',
    bottom: '2px',
    right: '2px',
    width: '16px',
    height: '16px',
    background: '#c0392b',
    color: '#fff',
    fontSize: '10px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'sans-serif',
    fontWeight: 'bold'
  },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.9)',
    color: '#fff',
    padding: '8px 12px',
    borderRadius: '6px',
    whiteSpace: 'nowrap',
    zIndex: 100,
    marginBottom: '5px',
    border: '1px solid #6b4c3a',
    pointerEvents: 'none'
  },
  tooltipName: {
    fontSize: '14px',
    fontFamily: "'Ma Shan Zheng', cursive",
    color: '#d4ac0d'
  },
  tooltipElement: {
    fontSize: '11px',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    marginTop: '2px',
    color: '#ccc'
  },
  draggingHerb: {
    position: 'fixed',
    zIndex: 1000,
    pointerEvents: 'none',
    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))'
  }
};

export default HerbCabinet;
