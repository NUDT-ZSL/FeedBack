import React from 'react';
import { motion } from 'framer-motion';
import { Projectile as ProjectileType } from '../types';
import { getTrajectoryPoints } from '../GameLogic';

interface ProjectileProps {
  projectile: ProjectileType;
  tileSize: number;
  index: number;
}

export const Projectile: React.FC<ProjectileProps> = ({ projectile, tileSize, index }) => {
  const trajectory = getTrajectoryPoints(projectile.startPos, projectile.endPos, 30);

  const getPosition = (progress: number) => {
    const idx = Math.min(Math.floor(progress * trajectory.length), trajectory.length - 1);
    const point = trajectory[idx];
    return {
      x: point.x * tileSize + tileSize / 2,
      y: point.y * tileSize + tileSize / 2
    };
  };

  const startPos = getPosition(0);
  const endPos = getPosition(1);
  const midPos = getPosition(0.5);

  if (projectile.type === 'arrow') {
    const angle = Math.atan2(
      projectile.endPos.y - projectile.startPos.y,
      projectile.endPos.x - projectile.startPos.x
    ) * 180 / Math.PI;

    return (
      <>
        <svg
          className="trajectory-line"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 20
          }}
        >
          <defs>
            <filter id={`glow-arrow-${index}`}>
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          <motion.path
            d={`M ${startPos.x} ${startPos.y} Q ${midPos.x} ${midPos.y - 50} ${endPos.x} ${endPos.y}`}
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth="1"
            strokeDasharray="5,5"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: projectile.duration / 1000, ease: 'linear' }}
          />
        </svg>

        <motion.div
          className={`projectile ${projectile.type}`}
          style={{
            position: 'absolute',
            width: '20px',
            height: '3px',
            zIndex: 25,
            pointerEvents: 'none'
          }}
          initial={{
            x: startPos.x - 10,
            y: startPos.y,
            rotate: angle,
            opacity: 1
          }}
          animate={{
            x: endPos.x - 10,
            y: endPos.y,
            rotate: angle,
            opacity: [1, 1, 0]
          }}
          transition={{
            duration: projectile.duration / 1000,
            ease: 'easeOut'
          }}
        >
          <div
            className="arrow-shaft"
            style={{
              position: 'absolute',
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: '70%',
              height: '100%',
              background: 'linear-gradient(90deg, #f5e6d3 0%, #d9c9b9 100%)',
              filter: `drop-shadow(0 0 3px rgba(255,255,255,0.8))`
            }}
          />
          <div
            className="arrow-head"
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 0,
              height: 0,
              borderTop: '5px solid transparent',
              borderBottom: '5px solid transparent',
              borderLeft: '8px solid #c0c0c0',
              filter: `drop-shadow(0 0 3px rgba(255,255,255,0.8))`
            }}
          />
          <div
            className="arrow-feather"
            style={{
              position: 'absolute',
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: '20%',
              height: '200%',
              background: 'linear-gradient(90deg, #c0392b, #922b21)',
              clipPath: 'polygon(0% 0%, 100% 30%, 100% 70%, 0% 100%)'
            }}
          />
        </motion.div>
      </>
    );
  }

  return (
    <>
      <svg
        className="trajectory-line"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 20
        }}
      >
        <defs>
          <filter id={`glow-stone-${index}`}>
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <motion.path
          d={`M ${startPos.x} ${startPos.y} Q ${midPos.x} ${midPos.y - 80} ${endPos.x} ${endPos.y}`}
          stroke="rgba(139, 94, 60, 0.5)"
          strokeWidth="3"
          strokeDasharray="10,5"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: projectile.duration / 1000, ease: 'linear' }}
          filter={`url(#glow-stone-${index})`}
        />
      </svg>

      <motion.div
        className={`projectile ${projectile.type}`}
        style={{
          position: 'absolute',
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, #a67c52 0%, #6b4423 50%, #4a2e1b 100%)',
          boxShadow: '0 4px 8px rgba(0,0,0,0.5), inset -4px -4px 8px rgba(0,0,0,0.3)',
          zIndex: 25,
          pointerEvents: 'none'
        }}
        initial={{
          x: startPos.x - 12,
          y: startPos.y - 12,
          rotate: 0,
          scale: 0.8
        }}
        animate={{
          x: endPos.x - 12,
          y: endPos.y - 12,
          rotate: 720,
          scale: [0.8, 1.2, 1]
        }}
        transition={{
          duration: projectile.duration / 1000,
          ease: 'easeOut'
        }}
      >
        <div style={{
          position: 'absolute',
          top: '20%',
          left: '25%',
          width: '20%',
          height: '20%',
          background: 'rgba(255,255,255,0.3)',
          borderRadius: '50%'
        }} />
      </motion.div>
    </>
  );
};
