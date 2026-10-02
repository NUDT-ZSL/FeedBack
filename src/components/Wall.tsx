import React from 'react';
import { motion } from 'framer-motion';
import { Wall as WallType } from '../game/types';
import {
  WALL_X,
  WALL_WIDTH,
  WALL_HEIGHT,
  WALL_SEGMENTS,
  GROUND_Y,
  COLORS,
} from '../game/constants';

interface WallProps {
  wall: WallType;
}

export const Wall: React.FC<WallProps> = ({ wall }) => {
  const segmentWidth = WALL_WIDTH / WALL_SEGMENTS;
  const durabilityPercent = (wall.durability / wall.maxDurability) * 100;
  const flagDown = wall.morale <= 30;

  const renderCracks = (segmentIndex: number, crackLevel: number) => {
    if (crackLevel === 0) return null;

    const x = WALL_X + segmentIndex * segmentWidth;
    const cracks = [];

    for (let i = 0; i < crackLevel; i++) {
      const startX = x + 10 + Math.random() * (segmentWidth - 20);
      const startY = GROUND_Y - WALL_HEIGHT + 20 + Math.random() * (WALL_HEIGHT - 40);
      const length = 20 + crackLevel * 15;
      const angle = Math.random() * 60 - 30;

      cracks.push(
        <motion.line
          key={`crack-${segmentIndex}-${i}`}
          x1={startX}
          y1={startY}
          x2={startX + Math.cos((angle * Math.PI) / 180) * length}
          y2={startY + Math.sin((angle * Math.PI) / 180) * length}
          stroke="#2a2a2a"
          strokeWidth={1 + crackLevel * 0.5}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: i * 0.1 }}
        />
      );

      if (crackLevel >= 2) {
        cracks.push(
          <motion.line
            key={`crack-${segmentIndex}-${i}-b`}
            x1={startX + length * 0.5}
            y1={startY}
            x2={startX + length * 0.5 + 15}
            y2={startY + 20}
            stroke="#2a2a2a"
            strokeWidth={1 + crackLevel * 0.3}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.8 }}
            transition={{ duration: 0.4, delay: i * 0.1 + 0.2 }}
          />
        );
      }

      if (crackLevel >= 3) {
        cracks.push(
          <motion.line
            key={`crack-${segmentIndex}-${i}-c`}
            x1={startX}
            y1={startY}
            x2={startX - 10}
            y2={startY + 30}
            stroke="#1a1a1a"
            strokeWidth={2}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.9 }}
            transition={{ duration: 0.6, delay: i * 0.1 + 0.3 }}
          />
        );
      }
    }

    return cracks;
  };

  const renderBricks = () => {
    const bricks = [];
    const brickHeight = 20;
    const brickWidth = 40;
    const rows = Math.floor(WALL_HEIGHT / brickHeight);

    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let col = -1; col < Math.ceil(WALL_WIDTH / brickWidth) + 1; col++) {
        const x = WALL_X + col * brickWidth + offset;
        const y = GROUND_Y - (row + 1) * brickHeight;

        bricks.push(
          <rect
            key={`brick-${row}-${col}`}
            x={x}
            y={y}
            width={brickWidth - 2}
            height={brickHeight - 2}
            fill={COLORS.wall}
            stroke={COLORS.wallDark}
            strokeWidth="1"
            opacity={0.6 + (row / rows) * 0.4}
          />
        );
      }
    }
    return bricks;
  };

  const renderBattlements = () => {
    const battlements = [];
    const battlementWidth = 25;
    const battlementHeight = 30;
    const count = Math.floor(WALL_WIDTH / battlementWidth);

    for (let i = 0; i < count; i++) {
      const x = WALL_X + i * battlementWidth;
      battlements.push(
        <rect
          key={`battlement-${i}`}
          x={x}
          y={GROUND_Y - WALL_HEIGHT - battlementHeight}
          width={battlementWidth - 3}
          height={battlementHeight}
          fill={COLORS.wall}
          stroke={COLORS.wallDark}
          strokeWidth="1"
        />
      );
    }
    return battlements;
  };

  const renderArchers = () => {
    if (wall.morale <= 30) return null;

    const archers = [];
    const positions = [0.2, 0.5, 0.8];

    positions.forEach((pos, i) => {
      const x = WALL_X + WALL_WIDTH * pos;
      const y = GROUND_Y - WALL_HEIGHT - 50;

      archers.push(
        <g key={`archer-${i}`}>
          <circle cx={x} cy={y} r="6" fill="#f5deb3" />
          <rect x={x - 5} y={y + 5} width="10" height="15" fill="#5a3a2a" />
          <line x1={x - 8} y1={y + 10} x2={x + 8} y2={y + 10} stroke="#8b4513" strokeWidth="2" />
          <line x1={x} y1={y + 5} x2={x - 15} y2={y - 5} stroke="#654321" strokeWidth="2" />
        </g>
      );
    });

    return archers;
  };

  return (
    <g>
      {renderBricks()}
      {renderBattlements()}
      {renderArchers()}

      {wall.crackLevel.map((level, index) => renderCracks(index, level))}

      <g>
        <line
          x1={WALL_X + WALL_WIDTH * 0.5}
          y1={GROUND_Y - WALL_HEIGHT - 30}
          x2={WALL_X + WALL_WIDTH * 0.5}
          y2={GROUND_Y - WALL_HEIGHT - 80}
          stroke="#4a3a2a"
          strokeWidth="4"
        />
        <motion.g
          animate={{
            rotateY: flagDown ? 90 : [0, 5, 0, -5, 0],
            y: flagDown ? 30 : 0,
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'linear',
          }}
          style={{
            transformOrigin: `${WALL_X + WALL_WIDTH * 0.5}px ${GROUND_Y - WALL_HEIGHT - 80}px`,
          }}
        >
          <polygon
            points={`${WALL_X + WALL_WIDTH * 0.5},${GROUND_Y - WALL_HEIGHT - 80}
                     ${WALL_X + WALL_WIDTH * 0.5 + 50},${GROUND_Y - WALL_HEIGHT - 70}
                     ${WALL_X + WALL_WIDTH * 0.5 + 50},${GROUND_Y - WALL_HEIGHT - 50}
                     ${WALL_X + WALL_WIDTH * 0.5},${GROUND_Y - WALL_HEIGHT - 60}`}
            fill={flagDown ? '#5a5a5a' : COLORS.flag}
            stroke={flagDown ? '#3a3a3a' : COLORS.flagDark}
            strokeWidth="2"
          />
        </motion.g>
      </g>

      <rect
        x={WALL_X}
        y={GROUND_Y - WALL_HEIGHT - 110}
        width={WALL_WIDTH}
        height="12"
        fill="#333"
        rx="4"
        opacity="0.8"
      />
      <motion.rect
        x={WALL_X + 2}
        y={GROUND_Y - WALL_HEIGHT - 108}
        width={(WALL_WIDTH - 4) * (durabilityPercent / 100)}
        height="8"
        fill={durabilityPercent > 50 ? '#ef4444' : durabilityPercent > 25 ? '#f59e0b' : '#6b7280'}
        rx="2"
        initial={{ width: 0 }}
        animate={{ width: (WALL_WIDTH - 4) * (durabilityPercent / 100) }}
        transition={{ duration: 0.3 }}
      />
      <text
        x={WALL_X + WALL_WIDTH / 2}
        y={GROUND_Y - WALL_HEIGHT - 118}
        textAnchor="middle"
        fill="#fff"
        fontSize="10"
        fontWeight="bold"
      >
        城墙耐久度 {Math.round(durabilityPercent)}%
      </text>

      <rect
        x={WALL_X}
        y={GROUND_Y - WALL_HEIGHT - 90}
        width={WALL_WIDTH}
        height="10"
        fill="#333"
        rx="4"
        opacity="0.8"
      />
      <motion.rect
        x={WALL_X + 2}
        y={GROUND_Y - WALL_HEIGHT - 88}
        width={(WALL_WIDTH - 4) * (wall.morale / 100)}
        height="6"
        fill={wall.morale > 50 ? '#fbbf24' : wall.morale > 30 ? '#f59e0b' : '#6b7280'}
        rx="2"
        initial={{ width: 0 }}
        animate={{ width: (WALL_WIDTH - 4) * (wall.morale / 100) }}
        transition={{ duration: 0.3 }}
      />
      <text
        x={WALL_X + WALL_WIDTH / 2}
        y={GROUND_Y - WALL_HEIGHT - 96}
        textAnchor="middle"
        fill="#fff"
        fontSize="9"
        fontWeight="bold"
      >
        守军士气 {Math.round(wall.morale)}% {wall.morale <= 30 && '(已崩溃)'}
      </text>
    </g>
  );
};
