import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Plant } from '../types';
import { SPECIES_ICONS, STAGE_NAMES, SPECIES_COLORS, HEALTH_COLORS } from '../constants';
import PlantCanvas, { AnimationType } from './PlantCanvas';

interface PlantCardProps {
  plant: Plant;
  isFriendGarden?: boolean;
  currentUserId?: string;
  onWater?: () => void;
  onFertilize?: () => void;
  onLight?: () => void;
  onClick?: () => void;
  showThanksAnimation?: boolean;
}

interface CooldownState {
  water: number;
  fertilize: number;
  light: number;
}

export const PlantCard: React.FC<PlantCardProps> = ({
  plant,
  isFriendGarden = false,
  currentUserId,
  onWater,
  onFertilize,
  onLight,
  onClick,
  showThanksAnimation = false,
}) => {
  const [cooldowns, setCooldowns] = useState<CooldownState>({ water: 0, fertilize: 0, light: 0 });
  const [animationType, setAnimationType] = useState<AnimationType>('none');
  const [isThanksVisible, setIsThanksVisible] = useState(showThanksAnimation);

  useEffect(() => {
    setIsThanksVisible(showThanksAnimation);
    if (showThanksAnimation) {
      setAnimationType('thanks');
      const timer = setTimeout(() => setIsThanksVisible(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [showThanksAnimation]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCooldowns(prev => ({
        water: Math.max(0, prev.water - 1),
        fertilize: Math.max(0, prev.fertilize - 1),
        light: Math.max(0, prev.light - 1),
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const triggerCooldown = useCallback((action: 'water' | 'fertilize' | 'light') => {
    setCooldowns(prev => ({ ...prev, [action]: 5 }));
  }, []);

  const handleWater = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cooldowns.water > 0 || !onWater) return;
    onWater();
    triggerCooldown('water');
    setAnimationType('water');
    setTimeout(() => setAnimationType('bounce'), 500);
  };

  const handleFertilize = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cooldowns.fertilize > 0 || !onFertilize) return;
    onFertilize();
    triggerCooldown('fertilize');
    setAnimationType('fertilize');
    setTimeout(() => setAnimationType('bounce'), 700);
  };

  const handleLight = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cooldowns.light > 0 || !onLight) return;
    onLight();
    triggerCooldown('light');
    setAnimationType('light');
    setTimeout(() => setAnimationType('bounce'), 800);
  };

  const handleAnimationEnd = useCallback(() => {
    setAnimationType('none');
  }, []);

  const isWaterDanger = plant.health.water < 20;
  const isLightDanger = plant.health.light < 20;
  const isNutritionDanger = plant.health.nutrition < 20;
  const isAnyDanger = isWaterDanger || isLightDanger || isNutritionDanger;

  const lastHelpers = plant.lastHelpers.slice(0, 3);

  return (
    <motion.div
      className={`card ${isAnyDanger ? 'card-danger' : ''}`}
      onClick={onClick}
      style={{
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        overflow: 'hidden',
      }}
      whileHover={{
        y: -4,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 20,
      }}
    >
      <AnimatePresence>
        {isThanksVisible && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: 'none',
              overflow: 'hidden',
              zIndex: 10,
            }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <motion.div
                key={i}
                initial={{
                  y: 120,
                  opacity: 1,
                  scale: 0.8,
                  x: 30 + (i * 25),
                }}
                animate={{
                  y: -60 - Math.random() * 40,
                  opacity: 0,
                  scale: 1.2 + Math.random() * 0.4,
                  x: 20 + (i * 25) + (Math.random() - 0.5) * 30,
                }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: 1.2 + Math.random() * 0.6,
                  delay: i * 0.1,
                  ease: 'easeOut',
                }}
                style={{
                  position: 'absolute',
                  fontSize: 20 + Math.random() * 10,
                  left: `${(i / 8) * 100}%`,
                  bottom: 20,
                }}
              >
                ❤️
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--spacing-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
          <span style={{ fontSize: '1.25rem' }}>{SPECIES_ICONS[plant.species]}</span>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{plant.name}</h3>
        </div>
        <span
          style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            backgroundColor: SPECIES_COLORS[plant.species] + '20',
            color: SPECIES_COLORS[plant.species],
            borderRadius: 'var(--radius-full)',
            fontWeight: 500,
          }}
        >
          {STAGE_NAMES[plant.stage]}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 'var(--spacing-sm)',
          backgroundColor: 'var(--color-cream)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--spacing-xs)',
        }}
      >
        <PlantCanvas
          plant={plant}
          width={160}
          height={160}
          animationType={animationType}
          onAnimationEnd={handleAnimationEnd}
        />
      </div>

      <div style={{ marginBottom: 'var(--spacing-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '2px' }}>
          <span style={{ color: 'var(--color-text-light)' }}>成长进度</span>
          <span style={{ color: SPECIES_COLORS[plant.species], fontWeight: 500 }}>
            {Math.floor(plant.progress)}%
          </span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{
              width: `${plant.progress}%`,
              backgroundColor: SPECIES_COLORS[plant.species],
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: 'var(--spacing-md)' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
            <span>💧 水分</span>
            <span style={{ color: isWaterDanger ? HEALTH_COLORS.danger : 'inherit' }}>
              {Math.floor(plant.health.water)}%
              {cooldowns.water > 0 && <span style={{ marginLeft: '4px', opacity: 0.7 }}>({cooldowns.water}s)</span>}
            </span>
          </div>
          <div className="progress-bar" style={{ height: '6px' }}>
            <div
              className={`progress-bar-fill ${isWaterDanger ? 'bar-danger' : ''}`}
              style={{
                width: `${plant.health.water}%`,
                backgroundColor: isWaterDanger ? HEALTH_COLORS.danger : HEALTH_COLORS.water,
              }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
            <span>☀️ 光照</span>
            <span style={{ color: isLightDanger ? HEALTH_COLORS.danger : 'inherit' }}>
              {Math.floor(plant.health.light)}%
              {cooldowns.light > 0 && <span style={{ marginLeft: '4px', opacity: 0.7 }}>({cooldowns.light}s)</span>}
            </span>
          </div>
          <div className="progress-bar" style={{ height: '6px' }}>
            <div
              className={`progress-bar-fill ${isLightDanger ? 'bar-danger' : ''}`}
              style={{
                width: `${plant.health.light}%`,
                backgroundColor: isLightDanger ? HEALTH_COLORS.danger : HEALTH_COLORS.light,
              }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
            <span>🌱 营养</span>
            <span style={{ color: isNutritionDanger ? HEALTH_COLORS.danger : 'inherit' }}>
              {Math.floor(plant.health.nutrition)}%
              {cooldowns.fertilize > 0 && <span style={{ marginLeft: '4px', opacity: 0.7 }}>({cooldowns.fertilize}s)</span>}
            </span>
          </div>
          <div className="progress-bar" style={{ height: '6px' }}>
            <div
              className={`progress-bar-fill ${isNutritionDanger ? 'bar-danger' : ''}`}
              style={{
                width: `${plant.health.nutrition}%`,
                backgroundColor: isNutritionDanger ? HEALTH_COLORS.danger : HEALTH_COLORS.nutrition,
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--spacing-xs)', marginBottom: lastHelpers.length > 0 ? 'var(--spacing-sm)' : 0 }}>
        <motion.button
          className="btn btn-secondary"
          style={{
            flex: 1,
            fontSize: '0.8rem',
            padding: '6px',
            opacity: cooldowns.water > 0 ? 0.5 : 1,
            cursor: cooldowns.water > 0 ? 'not-allowed' : 'pointer',
          }}
          onClick={handleWater}
          disabled={cooldowns.water > 0 || !onWater}
          whileTap={cooldowns.water === 0 && onWater ? { scale: 0.95 } : {}}
          whileHover={cooldowns.water === 0 && onWater ? { scale: 1.02 } : {}}
        >
          💧 {cooldowns.water > 0 ? `${cooldowns.water}s` : '浇水'}
        </motion.button>

        <motion.button
          className="btn btn-secondary"
          style={{
            flex: 1,
            fontSize: '0.8rem',
            padding: '6px',
            opacity: cooldowns.fertilize > 0 ? 0.5 : 1,
            cursor: cooldowns.fertilize > 0 ? 'not-allowed' : 'pointer',
          }}
          onClick={handleFertilize}
          disabled={cooldowns.fertilize > 0 || !onFertilize}
          whileTap={cooldowns.fertilize === 0 && onFertilize ? { scale: 0.95 } : {}}
          whileHover={cooldowns.fertilize === 0 && onFertilize ? { scale: 1.02 } : {}}
        >
          🌱 {cooldowns.fertilize > 0 ? `${cooldowns.fertilize}s` : '施肥'}
        </motion.button>

        {!isFriendGarden && (
          <motion.button
            className="btn btn-secondary"
            style={{
              flex: 1,
              fontSize: '0.8rem',
              padding: '6px',
              opacity: cooldowns.light > 0 ? 0.5 : 1,
              cursor: cooldowns.light > 0 ? 'not-allowed' : 'pointer',
            }}
            onClick={handleLight}
            disabled={cooldowns.light > 0 || !onLight}
            whileTap={cooldowns.light === 0 && onLight ? { scale: 0.95 } : {}}
            whileHover={cooldowns.light === 0 && onLight ? { scale: 1.02 } : {}}
          >
            ☀️ {cooldowns.light > 0 ? `${cooldowns.light}s` : '光照'}
          </motion.button>
        )}
      </div>

      {lastHelpers.length > 0 && (
        <div
          style={{
            paddingTop: 'var(--spacing-sm)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-xs)',
          }}
        >
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
            最近帮忙:
          </span>
          <div style={{ display: 'flex', gap: '2px' }}>
            {lastHelpers.map((helper, index) => (
              <motion.div
                key={`${helper.userId}-${index}`}
                title={helper.username}
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  backgroundColor: helper.avatar || 'var(--color-primary)',
                  backgroundImage: helper.avatar ? `url(${helper.avatar})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.65rem',
                  color: 'white',
                  fontWeight: 600,
                  border: helper.userId === currentUserId ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  marginLeft: index > 0 ? '-6px' : 0,
                  zIndex: lastHelpers.length - index,
                }}
                whileHover={{ scale: 1.2, zIndex: 100 }}
              >
                {!helper.avatar && helper.username.charAt(0).toUpperCase()}
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default PlantCard;
