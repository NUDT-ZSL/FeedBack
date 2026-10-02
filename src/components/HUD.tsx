import React from 'react';
import { motion } from 'framer-motion';
import { GamePhase } from '../game/types';

interface HUDProps {
  phase: GamePhase;
  turn: number;
  durability: number;
  maxDurability: number;
  morale: number;
  stoneAmmo: number;
  fireAmmo: number;
  onEndTurn: () => void;
  onRestart: () => void;
  onStartBattle: () => void;
  canStartBattle: boolean;
}

export const HUD: React.FC<HUDProps> = ({
  phase,
  turn,
  durability,
  maxDurability,
  morale,
  stoneAmmo,
  fireAmmo,
  onEndTurn,
  onRestart,
  onStartBattle,
  canStartBattle,
}) => {
  const durabilityPercent = (durability / maxDurability) * 100;

  const getPhaseText = () => {
    switch (phase) {
      case 'deploy':
        return '部署阶段';
      case 'playerTurn':
        return '我方回合';
      case 'enemyTurn':
        return '守军回合';
      case 'victory':
        return '胜利！';
      case 'defeat':
        return '战败';
      default:
        return '';
    }
  };

  const getPhaseColor = () => {
    switch (phase) {
      case 'deploy':
        return '#4ade80';
      case 'playerTurn':
        return '#60a5fa';
      case 'enemyTurn':
        return '#f87171';
      case 'victory':
        return '#fbbf24';
      case 'defeat':
        return '#6b7280';
      default:
        return '#fff';
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: '180px',
        right: 0,
        height: '80px',
        background: 'linear-gradient(180deg, rgba(90,58,42,0.95) 0%, rgba(74,42,26,0.9) 100%)',
        borderBottom: '3px solid #5a3a1a',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '30px',
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            color: '#f5deb3',
            fontSize: '12px',
            marginBottom: '4px',
          }}
        >
          当前阶段
        </div>
        <motion.div
          style={{
            color: getPhaseColor(),
            fontSize: '20px',
            fontWeight: 'bold',
            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
          }}
          animate={{ scale: phase === 'playerTurn' ? [1, 1.05, 1] : 1 }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          {getPhaseText()}
        </motion.div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            color: '#f5deb3',
            fontSize: '12px',
            marginBottom: '4px',
          }}
        >
          回合
        </div>
        <div
          style={{
            color: '#fff',
            fontSize: '24px',
            fontWeight: 'bold',
            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
          }}
        >
          第 {turn} 回合
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: '180px' }}>
        <div
          style={{
            color: '#f5deb3',
            fontSize: '12px',
            marginBottom: '4px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>城墙耐久度</span>
          <span>{Math.round(durabilityPercent)}%</span>
        </div>
        <div
          style={{
            width: '180px',
            height: '16px',
            background: '#333',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '2px solid #5a3a1a',
          }}
        >
          <motion.div
            style={{
              height: '100%',
              background: `linear-gradient(90deg, #991b1b 0%, #ef4444 50%, #f87171 100%)`,
              borderRadius: '6px',
            }}
            initial={{ width: '100%' }}
            animate={{ width: `${durabilityPercent}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: '180px' }}>
        <div
          style={{
            color: '#f5deb3',
            fontSize: '12px',
            marginBottom: '4px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>守军士气</span>
          <span>{Math.round(morale)}%</span>
        </div>
        <div
          style={{
            width: '180px',
            height: '16px',
            background: '#333',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '2px solid #5a3a1a',
          }}
        >
          <motion.div
            style={{
              height: '100%',
              background: `linear-gradient(90deg, #92400e 0%, #f59e0b 50%, #fbbf24 100%)`,
              borderRadius: '6px',
            }}
            initial={{ width: '100%' }}
            animate={{ width: `${morale}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', marginLeft: 'auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '8px',
            border: '2px solid #8a7a5a',
          }}
        >
          <div
            style={{
              width: '20px',
              height: '20px',
              background: '#8a7a5a',
              borderRadius: '50%',
              border: '2px solid #5a4a3a',
            }}
          />
          <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '16px' }}>
            石弹: {stoneAmmo}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '8px',
            border: '2px solid #ff6a00',
          }}
        >
          <div
            style={{
              width: '20px',
              height: '20px',
              background: '#ff6a00',
              borderRadius: '50%',
              border: '2px solid #cc5500',
              boxShadow: '0 0 10px rgba(255,106,0,0.5)',
            }}
          />
          <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '16px' }}>
            火油: {fireAmmo}
          </span>
        </div>
      </div>

      {phase === 'deploy' && canStartBattle && (
        <motion.button
          style={{
            padding: '10px 24px',
            background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
            color: '#fff',
            border: '3px solid #7f1d1d',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onStartBattle}
        >
          开始战斗！
        </motion.button>
      )}

      {phase === 'playerTurn' && (
        <motion.button
          style={{
            padding: '10px 24px',
            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            color: '#fff',
            border: '3px solid #1e40af',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onEndTurn}
        >
          结束回合
        </motion.button>
      )}

      {(phase === 'victory' || phase === 'defeat') && (
        <motion.button
          style={{
            padding: '10px 24px',
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            color: '#fff',
            border: '3px solid #065f46',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onRestart}
        >
          重新开始
        </motion.button>
      )}
    </div>
  );
};
