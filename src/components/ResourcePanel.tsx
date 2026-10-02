import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Resources } from '../types';
import { GRAIN_PER_PILE, ARROWS_PER_QUIVER, MAX_MORALE, MAX_CATAPULTS } from '../types';

interface ResourcePanelProps {
  side: 'left' | 'right';
  resources: Resources;
  catapultCount: number;
  gateDestroyed: boolean;
}

export const ResourcePanel: React.FC<ResourcePanelProps> = ({ side, resources, catapultCount, gateDestroyed }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLeft = side === 'left';

  const renderGrainPiles = () => {
    const piles = Math.ceil(resources.grain / GRAIN_PER_PILE);
    return (
      <div className="grain-container" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {Array.from({ length: Math.min(5, piles) }).map((_, i) => (
          <div key={i} className="grain-pile" style={{ position: 'relative', width: '40px', height: '30px' }}>
            {Array.from({ length: Math.min(GRAIN_PER_PILE, resources.grain - i * GRAIN_PER_PILE) }).map((_, j) => (
              <div
                key={j}
                className="grain-rice"
                style={{
                  position: 'absolute',
                  width: '6px',
                  height: '4px',
                  background: 'radial-gradient(ellipse at 30% 30%, #d4a76a 0%, #c49a6c 50%, #a67c52 100%)',
                  borderRadius: '50%',
                  left: `${10 + (j % 5) * 6 + Math.sin(j) * 3}px`,
                  top: `${5 + Math.floor(j / 5) * 5}px`,
                  transform: `rotate(${j * 15}deg)`,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderMoraleFlag = () => {
    const heightPercent = resources.morale;
    const flagHeight = 40 * (heightPercent / 100);
    
    return (
      <div className="morale-container" style={{ position: 'relative', height: '60px', width: '40px' }}>
        <div
          className="flag-pole"
          style={{
            position: 'absolute',
            left: '5px',
            top: 0,
            width: '4px',
            height: '100%',
            background: 'linear-gradient(180deg, #8b5e3c 0%, #5d3a1a 100%)',
            borderRadius: '2px'
          }}
        />
        <motion.div
          className="flag"
          style={{
            position: 'absolute',
            left: '9px',
            top: '5px',
            width: '30px',
            height: flagHeight,
            maxHeight: '40px',
            background: heightPercent > 50 
              ? 'linear-gradient(180deg, #e74c3c 0%, #c0392b 100%)'
              : heightPercent > 25
              ? 'linear-gradient(180deg, #f39c12 0%, #e67e22 100%)'
              : 'linear-gradient(180deg, #95a5a6 0%, #7f8c8d 100%)',
            clipPath: 'polygon(0% 0%, 100% 15%, 85% 50%, 100% 85%, 0% 100%)',
            boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
            transformOrigin: 'left center'
          }}
          animate={{ rotateY: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div
          className="flag-top"
          style={{
            position: 'absolute',
            top: '-3px',
            left: '2px',
            width: '10px',
            height: '10px',
            background: 'radial-gradient(circle, #ffd700 0%, #b8860b 100%)',
            borderRadius: '50%',
            boxShadow: '0 0 4px rgba(255,215,0,0.5)'
          }}
        />
      </div>
    );
  };

  const renderArrowQuivers = () => {
    const quivers = Math.ceil(resources.arrows);
    const isEmpty = resources.arrows < 0.1;
    
    return (
      <div className="arrows-container" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {Array.from({ length: Math.min(5, quivers) }).map((_, i) => {
          const isPartiallyUsed = i === Math.floor(resources.arrows);
          const fillPercent = isPartiallyUsed ? (resources.arrows % 1) * 100 : 100;
          
          return (
            <div
              key={i}
              className="arrow-quiver"
              style={{
                position: 'relative',
                width: '36px',
                height: '24px',
                background: isEmpty
                  ? 'linear-gradient(180deg, #999 0%, #777 100%)'
                  : 'linear-gradient(180deg, #8b5e3c 0%, #5d3a1a 100%)',
                borderRadius: '4px',
                border: '2px solid #3d2817',
                overflow: 'hidden'
              }}
            >
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: '100%',
                height: `${fillPercent}%`,
                background: 'linear-gradient(90deg, #c0c0c0 0%, #a0a0a0 50%, #808080 100%)',
                clipPath: 'polygon(10% 0%, 20% 100%, 30% 0%, 40% 100%, 50% 0%, 60% 100%, 70% 0%, 80% 100%, 90% 0%)'
              }} />
              <div style={{
                position: 'absolute',
                top: '3px',
                right: '3px',
                fontSize: '8px',
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.8)'
              }}>
                {Math.ceil((resources.arrows - i) * ARROWS_PER_QUIVER)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderWallDurability = () => {
    const brickCount = Math.ceil(resources.wallDurability / 20);
    const maxBricks = 5;
    
    return (
      <div className="wall-durability" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {Array.from({ length: maxBricks }).map((_, i) => (
          <div
            key={i}
            className="durability-brick"
            style={{
              width: '40px',
              height: '12px',
              background: i < brickCount
                ? 'linear-gradient(180deg, #a67c52 0%, #8b5e3c 50%, #6b4423 100%)'
                : 'linear-gradient(180deg, #555 0%, #333 100%)',
              border: '1px solid #4a2e1b',
              borderRadius: '2px',
              opacity: i < brickCount ? 1 : 0.4,
              boxShadow: i < brickCount ? 'inset 0 1px 2px rgba(255,255,255,0.2)' : 'none'
            }}
          />
        ))}
        {gateDestroyed && (
          <div style={{
            fontSize: '10px',
            color: '#e74c3c',
            textAlign: 'center',
            marginTop: '4px',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)'
          }}>
            城门已破!
          </div>
        )}
      </div>
    );
  };

  const renderMobileIcon = () => {
    if (isLeft) {
      return (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M16 4C16 4 8 8 8 16C8 24 16 28 16 28C16 28 24 24 24 16C24 8 16 4 16 4Z" fill="#d4a76a" stroke="#8b5e3c" strokeWidth="2"/>
          <path d="M16 8V24" stroke="#5d3a1a" strokeWidth="2"/>
          <path d="M12 12L20 12" stroke="#5d3a1a" strokeWidth="2"/>
          <path d="M10 16L22 16" stroke="#5d3a1a" strokeWidth="2"/>
        </svg>
      );
    } else {
      return (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M6 26L16 6L26 26H6Z" fill="#c0c0c0" stroke="#8b5e3c" strokeWidth="2"/>
          <rect x="14" y="20" width="4" height="8" fill="#8b5e3c"/>
        </svg>
      );
    }
  };

  const panelContent = isLeft ? (
    <>
      <div className="resource-item" style={{ marginBottom: '16px' }}>
        <div className="resource-label" style={{
          fontSize: '12px',
          color: '#f5e6d3',
          marginBottom: '4px',
          textAlign: 'center',
          textShadow: '0 1px 2px rgba(0,0,0,0.8)'
        }}>
          军粮
        </div>
        {renderGrainPiles()}
        <div style={{ fontSize: '10px', color: '#d9c9b9', textAlign: 'center', marginTop: '4px' }}>
          {Math.floor(resources.grain * GRAIN_PER_PILE)} 粒
        </div>
      </div>

      <div className="resource-item" style={{ marginBottom: '16px' }}>
        <div className="resource-label" style={{
          fontSize: '12px',
          color: '#f5e6d3',
          marginBottom: '4px',
          textAlign: 'center',
          textShadow: '0 1px 2px rgba(0,0,0,0.8)'
        }}>
          投石机
        </div>
        <div style={{
          fontSize: '24px',
          fontWeight: 'bold',
          color: '#ffd700',
          textAlign: 'center',
          textShadow: '0 2px 4px rgba(0,0,0,0.8)'
        }}>
          {catapultCount}/{MAX_CATAPULTS}
        </div>
      </div>

      <div className="resource-item">
        <div className="resource-label" style={{
          fontSize: '12px',
          color: '#f5e6d3',
          marginBottom: '4px',
          textAlign: 'center',
          textShadow: '0 1px 2px rgba(0,0,0,0.8)'
        }}>
          士气
        </div>
        {renderMoraleFlag()}
        <div style={{ fontSize: '10px', color: '#d9c9b9', textAlign: 'center', marginTop: '4px' }}>
          {Math.floor(resources.morale)}%
        </div>
      </div>
    </>
  ) : (
    <>
      <div className="resource-item" style={{ marginBottom: '16px' }}>
        <div className="resource-label" style={{
          fontSize: '12px',
          color: '#f5e6d3',
          marginBottom: '4px',
          textAlign: 'center',
          textShadow: '0 1px 2px rgba(0,0,0,0.8)'
        }}>
          箭矢
        </div>
        {renderArrowQuivers()}
        <div style={{ fontSize: '10px', color: '#d9c9b9', textAlign: 'center', marginTop: '4px' }}>
          {Math.floor(resources.arrows * ARROWS_PER_QUIVER)} 支
        </div>
      </div>

      <div className="resource-item">
        <div className="resource-label" style={{
          fontSize: '12px',
          color: '#f5e6d3',
          marginBottom: '4px',
          textAlign: 'center',
          textShadow: '0 1px 2px rgba(0,0,0,0.8)'
        }}>
          城墙
        </div>
        {renderWallDurability()}
        <div style={{ fontSize: '10px', color: '#d9c9b9', textAlign: 'center', marginTop: '4px' }}>
          {Math.floor(resources.wallDurability)}%
        </div>
      </div>
    </>
  );

  return (
    <>
      <div
        className={`resource-panel hide-mobile ${isLeft ? 'left' : 'right'}`}
        style={{
          position: 'absolute',
          [isLeft ? 'left' : 'right']: 0,
          top: '10%',
          width: '80px',
          height: '80%',
          background: 'rgba(42, 42, 42, 0.7)',
          backdropFilter: 'blur(4px)',
          padding: '16px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderRight: isLeft ? '2px solid rgba(139, 94, 60, 0.5)' : 'none',
          borderLeft: !isLeft ? '2px solid rgba(139, 94, 60, 0.5)' : 'none',
          zIndex: 100
        }}
      >
        {panelContent}
      </div>

      <div
        className={`resource-panel-mobile show-mobile ${isLeft ? 'left' : 'right'}`}
        style={{
          position: 'absolute',
          [isLeft ? 'left' : 'right']: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 100
        }}
      >
        <motion.button
          className="mobile-resource-btn watercolor-btn"
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'rgba(42, 42, 42, 0.8)',
            border: '2px solid #8b5e3c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)'
          }}
          onClick={() => setIsExpanded(!isExpanded)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          {renderMobileIcon()}
        </motion.button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              className="mobile-resource-popup"
              style={{
                position: 'absolute',
                [isLeft ? 'right' : 'left']: '60px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(42, 42, 42, 0.9)',
                backdropFilter: 'blur(8px)',
                padding: '16px',
                borderRadius: '12px',
                border: '2px solid #8b5e3c',
                minWidth: '150px'
              }}
              initial={{ opacity: 0, x: isLeft ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isLeft ? -20 : 20 }}
              transition={{ duration: 0.2 }}
            >
              {panelContent}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};
