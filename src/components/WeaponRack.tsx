import React from 'react';
import { motion } from 'framer-motion';
import { CatapultType } from '../game/types';
import { CATAPULT_CONFIGS, COLORS } from '../game/constants';

interface WeaponRackProps {
  onDragStart: (type: CatapultType, e: React.MouseEvent) => void;
  disabled: boolean;
}

export const WeaponRack: React.FC<WeaponRackProps> = ({ onDragStart, disabled }) => {
  const catapultTypes: { type: CatapultType; color: string }[] = [
    { type: 'light', color: '#a0d0a0' },
    { type: 'medium', color: '#d0a070' },
    { type: 'heavy', color: '#d07070' },
  ];

  const renderCatapultIcon = (type: CatapultType, color: string) => {
    switch (type) {
      case 'light':
        return (
          <g>
            <rect x="10" y="35" width="40" height="6" fill={COLORS.wood} rx="2" />
            <circle cx="18" cy="45" r="6" fill={COLORS.woodDark} />
            <circle cx="42" cy="45" r="6" fill={COLORS.woodDark} />
            <line x1="15" y1="35" x2="30" y2="10" stroke={COLORS.wood} strokeWidth="5" />
            <line x1="45" y1="35" x2="30" y2="10" stroke={COLORS.wood} strokeWidth="5" />
            <line x1="30" y1="10" x2="50" y2="20" stroke={COLORS.woodDark} strokeWidth="6" />
            <circle cx="52" cy="22" r="5" fill={color} />
          </g>
        );
      case 'medium':
        return (
          <g>
            <rect x="8" y="38" width="44" height="8" fill={COLORS.wood} rx="2" />
            <rect x="10" y="15" width="6" height="28" fill={COLORS.woodDark} />
            <rect x="44" y="15" width="6" height="28" fill={COLORS.woodDark} />
            <rect x="10" y="12" width="40" height="6" fill={COLORS.wood} />
            <line x1="30" y1="18" x2="55" y2="30" stroke={COLORS.woodDark} strokeWidth="7" />
            <rect x="52" y="26" width="10" height="10" fill={color} rx="2" />
            <rect x="12" y="-5" width="18" height="20" fill={COLORS.woodDark} rx="2" />
          </g>
        );
      case 'heavy':
        return (
          <g>
            <polygon points="5,48 55,48 45,15 15,15" fill={COLORS.wood} stroke={COLORS.woodDark} strokeWidth="2" />
            <rect x="22" y="-2" width="16" height="22" fill={COLORS.woodDark} rx="2" />
            <line x1="30" y1="8" x2="60" y2="25" stroke={COLORS.wood} strokeWidth="10" />
            <circle cx="62" cy="28" r="7" fill={color} />
            <circle cx="18" cy="52" r="5" fill={COLORS.woodDark} />
            <circle cx="42" cy="52" r="5" fill={COLORS.woodDark} />
          </g>
        );
    }
  };

  return (
    <div className="weapon-rack" style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: '180px',
      height: '100%',
      background: `linear-gradient(180deg, ${COLORS.weaponRack} 0%, #4a2a1a 100%)`,
      borderRight: `4px solid ${COLORS.woodDark}`,
      boxShadow: '4px 0 20px rgba(0,0,0,0.3)',
      padding: '20px 10px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '15px',
    }}>
      <h2 style={{
        color: '#f5deb3',
        fontSize: '18px',
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: '10px',
        textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
        borderBottom: `2px solid ${COLORS.wood}`,
        paddingBottom: '8px',
        width: '100%',
      }}>
        兵器架
      </h2>

      {!disabled && (
        <p style={{
          color: '#ddd',
          fontSize: '12px',
          textAlign: 'center',
          marginBottom: '5px',
        }}>
          拖拽投石机到机位
        </p>
      )}

      {catapultTypes.map(({ type, color }, index) => {
        const config = CATAPULT_CONFIGS[type];
        return (
          <motion.div
            key={type}
            className="catapult-card"
            style={{
              width: '140px',
              background: `linear-gradient(135deg, ${COLORS.wood} 0%, ${COLORS.woodDark} 100%)`,
              border: `3px solid ${COLORS.woodDark}`,
              borderRadius: '8px',
              padding: '10px',
              cursor: disabled ? 'not-allowed' : 'grab',
              opacity: disabled ? 0.5 : 1,
              boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
            }}
            whileHover={!disabled ? { scale: 1.05, boxShadow: '0 6px 12px rgba(0,0,0,0.4)' } : {}}
            whileTap={!disabled ? { scale: 0.98, cursor: 'grabbing' } : {}}
            onMouseDown={!disabled ? (e) => onDragStart(type, e) : undefined}
          >
            <svg width="70" height="55" viewBox="0 0 65 55" style={{ display: 'block', margin: '0 auto' }}>
              {renderCatapultIcon(type, color)}
            </svg>

            <div style={{
              marginTop: '8px',
              textAlign: 'center',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 'bold',
              textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
            }}>
              {config.name}
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '6px',
              fontSize: '10px',
              color: '#f5deb3',
            }}>
              <span>伤害: {config.damage}</span>
              <span>血量: {config.maxHealth}</span>
            </div>
          </motion.div>
        );
      })}

      <div style={{
        width: '140px',
        marginTop: '20px',
        padding: '10px',
        background: `linear-gradient(135deg, ${COLORS.wood} 0%, ${COLORS.woodDark} 100%)`,
        border: `3px solid ${COLORS.woodDark}`,
        borderRadius: '8px',
      }}>
        <svg width="100" height="40" viewBox="0 0 100 40" style={{ display: 'block', margin: '0 auto' }}>
          <rect x="10" y="25" width="80" height="10" fill={COLORS.wood} rx="2" />
          <circle cx="20" cy="38" r="5" fill={COLORS.woodDark} />
          <circle cx="80" cy="38" r="5" fill={COLORS.woodDark} />
          <rect x="25" y="15" width="20" height="15" fill={COLORS.metal} rx="2" />
          <ellipse cx="65" cy="22" rx="15" ry="8" fill="#ff6a00" opacity="0.8" />
        </svg>
        <div style={{
          textAlign: 'center',
          color: '#fff',
          fontSize: '11px',
          marginTop: '5px',
          fontWeight: 'bold',
        }}>
          弹药车
        </div>
      </div>
    </div>
  );
};
