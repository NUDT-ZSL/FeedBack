import React from 'react';
import { motion } from 'framer-motion';
import { Catapult as CatapultType, AmmoType } from '../game/types';
import { CATAPULT_CONFIGS, COLORS } from '../game/constants';

interface CatapultProps {
  catapult: CatapultType;
  isSelected: boolean;
  onClick: () => void;
  onRepair: () => void;
  onAmmoChange: (type: AmmoType) => void;
  stoneAmmo: number;
  fireAmmo: number;
}

export const Catapult: React.FC<CatapultProps> = ({
  catapult,
  isSelected,
  onClick,
  onRepair,
  onAmmoChange,
  stoneAmmo,
  fireAmmo,
}) => {
  const config = CATAPULT_CONFIGS[catapult.type];
  const healthPercent = (catapult.health / catapult.maxHealth) * 100;

  const renderLightCatapult = () => (
    <g>
      <rect x="-25" y="10" width="50" height="8" fill={COLORS.wood} rx="2" />
      <circle cx="-18" cy="25" r="8" fill={COLORS.woodDark} stroke="#3a2a1a" strokeWidth="2" />
      <circle cx="18" cy="25" r="8" fill={COLORS.woodDark} stroke="#3a2a1a" strokeWidth="2" />
      <line x1="-18" y1="25" x2="-18" y2="10" stroke="#3a2a1a" strokeWidth="1" />
      <line x1="18" y1="25" x2="18" y2="10" stroke="#3a2a1a" strokeWidth="1" />
      <line x1="-15" y1="10" x2="0" y2="-35" stroke={COLORS.wood} strokeWidth="6" />
      <line x1="15" y1="10" x2="0" y2="-35" stroke={COLORS.wood} strokeWidth="6" />
      <line x1="0" y1="-35" x2="25" y2="-20" stroke={COLORS.woodDark} strokeWidth="8" />
      <circle cx="30" cy="-18" r="8" fill={COLORS.metal} stroke={COLORS.metalDark} strokeWidth="2" />
      <line x1="-20" y1="0" x2="-30" y2="20" stroke={COLORS.wood} strokeWidth="3" />
    </g>
  );

  const renderMediumCatapult = () => (
    <g>
      <rect x="-30" y="15" width="60" height="10" fill={COLORS.wood} rx="2" />
      <rect x="-28" y="-10" width="8" height="40" fill={COLORS.woodDark} />
      <rect x="20" y="-10" width="8" height="40" fill={COLORS.woodDark} />
      <rect x="-28" y="-15" width="56" height="8" fill={COLORS.wood} />
      <line x1="-24" y1="-5" x2="24" y2="-5" stroke={COLORS.metal} strokeWidth="2" />
      <line x1="0" y1="-5" x2="35" y2="10" stroke={COLORS.woodDark} strokeWidth="10" />
      <rect x="32" y="5" width="12" height="12" fill={COLORS.metal} rx="2" />
      <rect x="-25" y="-35" width="20" height="25" fill={COLORS.woodDark} rx="3" />
      <line x1="-15" y1="-35" x2="10" y2="-5" stroke={COLORS.metal} strokeWidth="3" />
      <circle cx="-8" cy="0" r="5" fill={COLORS.metalDark} />
    </g>
  );

  const renderHeavyCatapult = () => (
    <g>
      <polygon points="-35,25 35,25 25,-10 -25,-10" fill={COLORS.wood} stroke={COLORS.woodDark} strokeWidth="2" />
      <line x1="-35" y1="25" x2="0" y2="-10" stroke={COLORS.woodDark} strokeWidth="3" />
      <line x1="35" y1="25" x2="0" y2="-10" stroke={COLORS.woodDark} strokeWidth="3" />
      <rect x="-10" y="-30" width="20" height="25" fill={COLORS.woodDark} rx="2" />
      <line x1="0" y1="-20" x2="40" y2="0" stroke={COLORS.wood} strokeWidth="12" />
      <circle cx="45" cy="5" r="10" fill={COLORS.metal} stroke={COLORS.metalDark} strokeWidth="3" />
      <circle cx="-5" cy="-20" r="6" fill={COLORS.metalDark} />
      <line x1="-30" y1="25" x2="-30" y2="-5" stroke={COLORS.woodDark} strokeWidth="4" />
      <line x1="30" y1="25" x2="30" y2="-5" stroke={COLORS.woodDark} strokeWidth="4" />
      <circle cx="-15" cy="30" r="6" fill={COLORS.woodDark} stroke="#3a2a1a" strokeWidth="2" />
      <circle cx="15" cy="30" r="6" fill={COLORS.woodDark} stroke="#3a2a1a" strokeWidth="2" />
    </g>
  );

  const renderCatapult = () => {
    switch (catapult.type) {
      case 'light':
        return renderLightCatapult();
      case 'medium':
        return renderMediumCatapult();
      case 'heavy':
        return renderHeavyCatapult();
    }
  };

  return (
    <g>
      <motion.g
        style={{ cursor: catapult.isDamaged ? 'default' : 'pointer' }}
        onClick={!catapult.isDamaged ? onClick : undefined}
        whileHover={!catapult.isDamaged ? { scale: 1.05 } : {}}
        animate={{
          x: catapult.position.x,
          y: catapult.position.y,
          opacity: catapult.isDamaged ? 0.5 : 1,
        }}
        transition={{ type: 'spring', stiffness: 300 }}
      >
        {isSelected && (
          <motion.circle
            r="50"
            fill="none"
            stroke="#ffd700"
            strokeWidth="3"
            strokeDasharray="8,4"
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          />
        )}

        <g transform={`rotate(-${catapult.angle + 15})`}>{renderCatapult()}</g>

        <rect x="-30" y="35" width="60" height="8" fill="#333" rx="2" />
        <rect
          x="-28"
          y="37"
          width={56 * (healthPercent / 100)}
          height="4"
          fill={healthPercent > 50 ? '#4ade80' : healthPercent > 25 ? '#fbbf24' : '#ef4444'}
          rx="1"
        />

        {catapult.hasFired && (
          <text x="0" y="-55" textAnchor="middle" fill="#888" fontSize="12">
            已发射
          </text>
        )}

        {catapult.isDamaged && (
          <g>
            <text x="0" y="-55" textAnchor="middle" fill="#ef4444" fontSize="14" fontWeight="bold">
              已损坏
            </text>
            <motion.rect
              x="-35"
              y="-45"
              width="70"
              height="25"
              fill={COLORS.wood}
              stroke={COLORS.woodDark}
              strokeWidth="2"
              rx="4"
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                onRepair();
              }}
              whileHover={{ scale: 1.05 }}
            />
            <text
              x="0"
              y="-28"
              textAnchor="middle"
              fill="#fff"
              fontSize="12"
              fontWeight="bold"
              style={{ pointerEvents: 'none' }}
            >
              点击修复
            </text>
          </g>
        )}

        {!catapult.isDamaged && !catapult.hasFired && isSelected && (
          <g transform="translate(0, -70)">
            <motion.rect
              x="-50"
              y="-12"
              width="45"
              height="24"
              fill={catapult.ammoType === 'stone' ? COLORS.metal : COLORS.wood}
              stroke="#333"
              strokeWidth="2"
              rx="4"
              style={{ cursor: stoneAmmo > 0 ? 'pointer' : 'not-allowed' }}
              onClick={(e) => {
                e.stopPropagation();
                if (stoneAmmo > 0) onAmmoChange('stone');
              }}
              whileHover={stoneAmmo > 0 ? { scale: 1.05 } : {}}
            />
            <text x="-27" y="4" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold">
              石弹 {stoneAmmo}
            </text>

            <motion.rect
              x="5"
              y="-12"
              width="45"
              height="24"
              fill={catapult.ammoType === 'fire' ? '#ff6a00' : COLORS.wood}
              stroke="#333"
              strokeWidth="2"
              rx="4"
              style={{ cursor: fireAmmo > 0 ? 'pointer' : 'not-allowed' }}
              onClick={(e) => {
                e.stopPropagation();
                if (fireAmmo > 0) onAmmoChange('fire');
              }}
              whileHover={fireAmmo > 0 ? { scale: 1.05 } : {}}
            />
            <text x="27" y="4" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold">
              火油 {fireAmmo}
            </text>
          </g>
        )}
      </motion.g>

      <text
        x={catapult.position.x}
        y={catapult.position.y + 55}
        textAnchor="middle"
        fill="#333"
        fontSize="12"
        fontWeight="bold"
      >
        {config.name}
      </text>
    </g>
  );
};
