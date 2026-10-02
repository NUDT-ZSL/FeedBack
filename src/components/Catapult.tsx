import React from 'react';
import { motion } from 'framer-motion';
import { Catapult as CatapultType } from '../types';

interface CatapultProps {
  catapult: CatapultType;
  tileSize: number;
  isSelected: boolean;
  onClick: () => void;
}

export const Catapult: React.FC<CatapultProps> = ({ catapult, tileSize, isSelected, onClick }) => {
  const x = catapult.position.x * tileSize;
  const y = catapult.position.y * tileSize;

  return (
    <motion.div
      className={`catapult ${isSelected ? 'selected' : ''} ${catapult.isStunned ? 'stunned' : ''}`}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: tileSize,
        height: tileSize,
        cursor: 'pointer',
        zIndex: 10
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      animate={isSelected ? { scale: [1, 1.05, 1] } : {}}
      transition={{ duration: 0.5, repeat: isSelected ? Infinity : 0 }}
      whileHover={{ scale: 1.1 }}
    >
      <div
        className="catapult-base"
        style={{
          position: 'absolute',
          bottom: '10%',
          left: '10%',
          width: '80%',
          height: '30%',
          background: 'linear-gradient(180deg, #8b5e3c 0%, #5d3a1a 100%)',
          borderRadius: '4px',
          border: '2px solid #3d2817',
          boxShadow: isSelected ? '0 0 15px rgba(255, 215, 0, 0.8)' : '0 4px 8px rgba(0,0,0,0.3)'
        }}
      >
        <div style={{
          position: 'absolute',
          top: '20%',
          left: '20%',
          width: '10%',
          height: '60%',
          background: '#4a2e1b',
          borderRadius: '2px'
        }} />
        <div style={{
          position: 'absolute',
          top: '20%',
          right: '20%',
          width: '10%',
          height: '60%',
          background: '#4a2e1b',
          borderRadius: '2px'
        }} />
      </div>

      <motion.div
        className="catapult-arm"
        style={{
          position: 'absolute',
          bottom: '35%',
          left: '45%',
          width: '10%',
          height: '50%',
          background: 'linear-gradient(90deg, #6b4423 0%, #8b5e3c 50%, #6b4423 100%)',
          borderRadius: '3px',
          transformOrigin: 'bottom center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
        }}
        animate={catapult.hasActed ? { rotate: 30 } : { rotate: -15 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div
          className="catapult-basket"
          style={{
            position: 'absolute',
            top: '-15%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '200%',
            height: '40%',
            background: 'radial-gradient(ellipse at center, #a67c52 0%, #6b4423 100%)',
            borderRadius: '50% 50% 30% 30%',
            border: '2px solid #4a2e1b'
          }}
        >
          {!catapult.hasActed && (
            <div style={{
              position: 'absolute',
              top: '20%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '50%',
              height: '60%',
              background: 'radial-gradient(circle at 30% 30%, #a67c52, #6b4423)',
              borderRadius: '50%',
              boxShadow: 'inset -2px -2px 4px rgba(0,0,0,0.4)'
            }} />
          )}
        </div>
      </motion.div>

      <div
        className="catapult-wheel wheel-left"
        style={{
          position: 'absolute',
          bottom: '5%',
          left: '15%',
          width: '25%',
          height: '25%',
          background: 'radial-gradient(circle at 50% 50%, #8b5e3c 0%, #5d3a1a 70%, #3d2817 100%)',
          borderRadius: '50%',
          border: '2px solid #3d2817',
          boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '10%',
          width: '80%',
          height: '2px',
          background: '#3d2817'
        }} />
        <div style={{
          position: 'absolute',
          top: '10%',
          left: '50%',
          width: '2px',
          height: '80%',
          background: '#3d2817'
        }} />
      </div>

      <div
        className="catapult-wheel wheel-right"
        style={{
          position: 'absolute',
          bottom: '5%',
          right: '15%',
          width: '25%',
          height: '25%',
          background: 'radial-gradient(circle at 50% 50%, #8b5e3c 0%, #5d3a1a 70%, #3d2817 100%)',
          borderRadius: '50%',
          border: '2px solid #3d2817',
          boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '10%',
          width: '80%',
          height: '2px',
          background: '#3d2817'
        }} />
        <div style={{
          position: 'absolute',
          top: '10%',
          left: '50%',
          width: '2px',
          height: '80%',
          background: '#3d2817'
        }} />
      </div>

      {catapult.isStunned && (
        <motion.div
          className="stun-effect"
          style={{
            position: 'absolute',
            top: '-20%',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '20px',
            color: '#ffd700',
            textShadow: '0 0 10px rgba(255, 215, 0, 0.8)'
          }}
          animate={{ rotate: [0, 15, -15, 0], y: [0, -5, 0] }}
          transition={{ duration: 0.5, repeat: Infinity }}
        >
          💫
        </motion.div>
      )}

      <div
        className="health-bar"
        style={{
          position: 'absolute',
          top: '-10%',
          left: '10%',
          width: '80%',
          height: '6px',
          background: '#333',
          borderRadius: '3px',
          overflow: 'hidden',
          border: '1px solid #1a1a1a'
        }}
      >
        <div
          style={{
            width: `${catapult.health}%`,
            height: '100%',
            background: catapult.health > 50
              ? 'linear-gradient(90deg, #4caf50, #8bc34a)'
              : catapult.health > 25
              ? 'linear-gradient(90deg, #ff9800, #ffc107)'
              : 'linear-gradient(90deg, #f44336, #ff5722)',
            transition: 'width 0.3s ease'
          }}
        />
      </div>

      {catapult.hasActed && !catapult.isStunned && (
        <div
          style={{
            position: 'absolute',
            top: '5%',
            right: '5%',
            width: '12px',
            height: '12px',
            background: '#999',
            borderRadius: '50%',
            border: '2px solid #666',
            fontSize: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff'
          }}
        >
          ✓
        </div>
      )}
    </motion.div>
  );
};
