import React from 'react';
import { motion } from 'framer-motion';
import { WallSegment } from '../types';

interface CityWallProps {
  segments: WallSegment[];
  tileSize: number;
  gateDestroyed: boolean;
}

export const CityWall: React.FC<CityWallProps> = ({ segments, tileSize, gateDestroyed }) => {
  const gateX = Math.floor(segments.length / 2);

  return (
    <div className="city-wall" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '40%' }}>
      <div 
        className="city-inner"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '75%',
          background: 'linear-gradient(180deg, #e8d5b7 0%, #d4c4a8 100%)',
          borderBottom: '3px solid #8b5e3c'
        }}
      >
        {[gateX - 4, gateX, gateX + 4].map((x, idx) => (
          <div
            key={`tower-${idx}`}
            style={{
              position: 'absolute',
              left: `${x * tileSize}px`,
              bottom: 0,
              width: `${tileSize * 1.5}px`,
              height: `${tileSize * 2}px`,
              transform: 'translateX(-25%)'
            }}
          >
            <div 
              className="tower-base"
              style={{
                position: 'absolute',
                bottom: 0,
                width: '100%',
                height: '60%',
                background: 'linear-gradient(180deg, #a67c52 0%, #6b4423 100%)',
                borderRadius: '4px 4px 0 0',
                boxShadow: 'inset -4px 0 8px rgba(0,0,0,0.3)'
              }}
            >
              <div style={{
                position: 'absolute',
                bottom: '30%',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '30%',
                height: '40%',
                background: '#4a2e1b',
                borderRadius: '2px 2px 0 0'
              }} />
            </div>
            
            <div
              className="tower-roof-1"
              style={{
                position: 'absolute',
                bottom: '60%',
                left: '-10%',
                width: '120%',
                height: '25%',
                background: 'linear-gradient(180deg, #7a9e7a 0%, #6b8e6b 50%, #4a6b4a 100%)',
                clipPath: 'polygon(0% 100%, 5% 0%, 95% 0%, 100% 100%)',
                boxShadow: '0 4px 8px rgba(0,0,0,0.3)'
              }}
            />
            
            <div
              className="tower-roof-2"
              style={{
                position: 'absolute',
                bottom: '80%',
                left: '10%',
                width: '80%',
                height: '20%',
                background: 'linear-gradient(180deg, #7a9e7a 0%, #5a7e5a 100%)',
                clipPath: 'polygon(0% 100%, 10% 0%, 90% 0%, 100% 100%)'
              }}
            />
            
            <div style={{
              position: 'absolute',
              top: '5%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '4px',
              height: `${tileSize * 0.8}px`,
              background: '#5d3a1a'
            }}>
              <motion.div
                animate={{ rotateY: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '100%',
                  width: `${tileSize * 0.5}px`,
                  height: `${tileSize * 0.4}px`,
                  background: idx === 1 ? (gateDestroyed ? '#ffd700' : '#c0392b') : '#c0392b',
                  clipPath: 'polygon(0% 0%, 100% 15%, 85% 50%, 100% 85%, 0% 100%)',
                  transformOrigin: 'left center',
                  boxShadow: '2px 2px 4px rgba(0,0,0,0.3)'
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {segments.map((segment) => (
        <div
          key={segment.id}
          className="wall-segment"
          style={{
            position: 'absolute',
            left: `${segment.position.x * tileSize}px`,
            top: `${segment.position.y * tileSize * 0.75}px`,
            width: `${tileSize}px`,
            height: `${tileSize * 1.2}px`,
          }}
        >
          <div
            className={`wall-brick brick-texture ${segment.isGate && gateDestroyed ? 'gate-fallen' : ''}`}
            style={{
              position: 'absolute',
              bottom: 0,
              width: '100%',
              height: '100%',
              background: segment.isGate 
                ? 'linear-gradient(180deg, #c0392b 0%, #922b21 50%, #7a1f1f 100%)'
                : undefined,
              border: '2px solid #4a2e1b',
              borderRadius: segment.isGate ? '4px 4px 0 0' : '2px',
              opacity: Math.max(0.3, segment.durability / 100),
              transform: segment.isGate && gateDestroyed ? 'perspective(200px) rotateX(90deg)' : 'none',
              transformOrigin: 'bottom',
              transition: 'transform 0.8s ease-out, opacity 0.3s'
            }}
          >
            {segment.isGate && !gateDestroyed && (
              <>
                <div style={{
                  position: 'absolute',
                  top: '10%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '80%',
                  height: '2px',
                  background: '#4a2e1b'
                }} />
                <div style={{
                  position: 'absolute',
                  top: '30%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '80%',
                  height: '2px',
                  background: '#4a2e1b'
                }} />
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '80%',
                  height: '2px',
                  background: '#4a2e1b'
                }} />
                <div style={{
                  position: 'absolute',
                  top: '70%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '80%',
                  height: '2px',
                  background: '#4a2e1b'
                }} />
                <div style={{
                  position: 'absolute',
                  top: '45%',
                  right: '15%',
                  width: '8px',
                  height: '8px',
                  background: 'radial-gradient(circle, #ffd700 0%, #b8860b 100%)',
                  borderRadius: '50%',
                  boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                }} />
              </>
            )}

            {segment.cracks.map((crack) => (
              <div
                key={crack.id}
                className="crack"
                style={{
                  position: 'absolute',
                  top: '10%',
                  left: '10%',
                  width: '80%',
                  height: '80%',
                  background: '#4a2e1b',
                  clipPath: crack.clipPath,
                  opacity: 0.7 + crack.size * 0.05
                }}
              />
            ))}
          </div>

          {!segment.isGate && (
            <div
              className="crenellation"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                width: '100%',
                height: '20%',
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0 10%'
              }}
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: '25%',
                    height: '100%',
                    background: 'linear-gradient(180deg, #8b5e3c 0%, #6b4423 100%)',
                    border: '1px solid #4a2e1b',
                    borderBottom: 'none',
                    borderRadius: '2px 2px 0 0'
                  }}
                />
              ))}
            </div>
          )}

          <div
            className="durability-bar"
            style={{
              position: 'absolute',
              bottom: '-8px',
              left: '10%',
              width: '80%',
              height: '4px',
              background: '#333',
              borderRadius: '2px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${segment.durability}%`,
                height: '100%',
                background: segment.durability > 50 
                  ? 'linear-gradient(90deg, #4caf50, #8bc34a)' 
                  : segment.durability > 25
                  ? 'linear-gradient(90deg, #ff9800, #ffc107)'
                  : 'linear-gradient(90deg, #f44336, #ff5722)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>
      ))}

      <div
        className="wall-base"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: `${tileSize * 0.3}px`,
          background: 'linear-gradient(180deg, #6b4423 0%, #4a2e1b 100%)',
          borderTop: '2px solid #3d2817'
        }}
      />
    </div>
  );
};
