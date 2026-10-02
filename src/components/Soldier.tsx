import React from 'react';
import { motion } from 'framer-motion';
import { Soldier as SoldierType } from '../types';

interface SoldierProps {
  soldier: SoldierType;
  tileSize: number;
}

export const Soldier: React.FC<SoldierProps> = ({ soldier, tileSize }) => {
  const x = soldier.position.x * tileSize;
  const y = soldier.position.y * tileSize;
  const isRebel = soldier.side === 'rebels';

  return (
    <motion.div
      className={`soldier ${isRebel ? 'rebel' : 'imperial'}`}
      style={{
        position: 'absolute',
        left: x + tileSize * 0.3,
        top: y + tileSize * 0.2,
        width: tileSize * 0.4,
        height: tileSize * 0.6,
        zIndex: 15
      }}
      initial={{ scale: 0, y: 20 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <motion.div
        className="soldier-body"
        style={{
          position: 'absolute',
          bottom: 0,
          left: '20%',
          width: '60%',
          height: '70%',
          background: isRebel 
            ? 'linear-gradient(180deg, #5d3a1a 0%, #4a2e1b 100%)'
            : 'linear-gradient(180deg, #c0392b 0%, #922b21 100%)',
          borderRadius: '4px 4px 2px 2px',
          border: '1px solid rgba(0,0,0,0.3)'
        }}
        animate={soldier.isDying ? { scale: 0, opacity: 0 } : {}}
        transition={{ duration: 0.5 }}
      >
        <div style={{
          position: 'absolute',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '60%',
          height: '2px',
          background: 'rgba(0,0,0,0.2)'
        }} />
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '60%',
          height: '2px',
          background: 'rgba(0,0,0,0.2)'
        }} />
      </motion.div>

      <motion.div
        className="soldier-head"
        style={{
          position: 'absolute',
          top: 0,
          left: '25%',
          width: '50%',
          height: '30%',
          background: 'radial-gradient(circle at 30% 30%, #f4d03f 0%, #d4ac0d 70%, #b7950b 100%)',
          borderRadius: '50%',
          border: '1px solid rgba(0,0,0,0.3)'
        }}
        animate={soldier.isDying ? { y: 20, opacity: 0 } : {}}
      >
        <div style={{
          position: 'absolute',
          top: '35%',
          left: '25%',
          width: '15%',
          height: '15%',
          background: '#000',
          borderRadius: '50%'
        }} />
        <div style={{
          position: 'absolute',
          top: '35%',
          right: '25%',
          width: '15%',
          height: '15%',
          background: '#000',
          borderRadius: '50%'
        }} />
      </motion.div>

      <div
        className="soldier-legs"
        style={{
          position: 'absolute',
          bottom: 0,
          left: '30%',
          width: '40%',
          height: '15%',
          display: 'flex',
          justifyContent: 'space-between'
        }}
      >
        <div style={{
          width: '35%',
          height: '100%',
          background: '#4a2e1b',
          borderRadius: '0 0 2px 2px'
        }} />
        <div style={{
          width: '35%',
          height: '100%',
          background: '#4a2e1b',
          borderRadius: '0 0 2px 2px'
        }} />
      </div>

      {!isRebel && (
        <motion.div
          className="soldier-spear"
          style={{
            position: 'absolute',
            top: '10%',
            right: '-20%',
            width: '8px',
            height: '100%',
            background: 'linear-gradient(180deg, #8b5e3c 0%, #5d3a1a 100%)',
            borderRadius: '2px',
            transformOrigin: 'bottom center'
          }}
          animate={{ rotate: soldier.hasMoved ? 0 : [-5, 5, -5] }}
          transition={{ duration: 2, repeat: soldier.hasMoved ? 0 : Infinity }}
        >
          <div style={{
            position: 'absolute',
            top: '-15%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: '15px solid #c0c0c0'
          }} />
        </motion.div>
      )}

      {isRebel && (
        <div
          className="soldier-sword"
          style={{
            position: 'absolute',
            top: '30%',
            right: '-15%',
            width: '6px',
            height: '40%',
            background: 'linear-gradient(180deg, #e0e0e0 0%, #a0a0a0 100%)',
            borderRadius: '1px',
            transform: 'rotate(-30deg)'
          }}
        />
      )}

      <div
        className="soldier-health"
        style={{
          position: 'absolute',
          top: '-15%',
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
            width: `${soldier.health}%`,
            height: '100%',
            background: soldier.health > 50 ? '#4caf50' : '#f44336',
            transition: 'width 0.3s ease'
          }}
        />
      </div>
    </motion.div>
  );
};
