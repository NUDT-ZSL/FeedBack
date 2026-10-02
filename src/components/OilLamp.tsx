import React from 'react';
import { motion } from 'framer-motion';
import { useGrindingStore } from '@/store/useGrindingStore';
import { LightPosition } from '@/types';

const OilLamp: React.FC = () => {
  const { lightPosition, setLightPosition } = useGrindingStore();

  const positions: Array<{ pos: LightPosition; label: string; x: number; y: number }> = [
    { pos: 'front', label: '正前方', x: 0, y: -100 },
    { pos: 'left45', label: '左侧45°', x: -80, y: -60 },
    { pos: 'right90', label: '右侧90°', x: 100, y: 0 },
  ];

  const currentPosition = positions.find((p) => p.pos === lightPosition) || positions[0];

  const handleClick = () => {
    const currentIndex = positions.findIndex((p) => p.pos === lightPosition);
    const nextIndex = (currentIndex + 1) % positions.length;
    setLightPosition(positions[nextIndex].pos);
  };

  return (
    <motion.div
      className="absolute cursor-pointer z-10"
      style={{
        right: 30,
        bottom: 30,
      }}
      onClick={handleClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <div className="relative">
        <motion.div
          className="relative"
          animate={{
            x: currentPosition.x * 0.3,
            y: currentPosition.y * 0.3,
          }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div
            className="relative"
            style={{ width: 40, height: 50 }}
          >
            <div
              className="absolute bottom-0 left-1/2 transform -translate-x-1/2 rounded-t-lg"
              style={{
                width: 35,
                height: 25,
                background: 'linear-gradient(145deg, #c88333 0%, #8b5a2b 50%, #6b4423 100%)',
                borderRadius: '50% 50% 10% 10% / 30% 30% 10% 10%',
                boxShadow: 'inset 0 2px 5px rgba(255,255,255,0.3), 0 4px 10px rgba(0,0,0,0.4)',
              }}
            />
            <div
              className="absolute bottom-5 left-1/2 transform -translate-x-1/2"
              style={{
                width: 8,
                height: 12,
                background: 'linear-gradient(to top, #4a2e1b, #2a1e10)',
                borderRadius: '2px 2px 0 0',
              }}
            />
            <motion.div
              className="absolute left-1/2 transform -translate-x-1/2"
              style={{
                bottom: 42,
                width: 20,
                height: 30,
              }}
              animate={{
                scale: [1, 1.1, 0.95, 1.05, 1],
                opacity: [0.9, 1, 0.85, 1, 0.9],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: 'radial-gradient(ellipse at 50% 70%, #fff7e0 0%, #ffd700 30%, #ff8c00 60%, transparent 100%)',
                  borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                  filter: 'blur(1px)',
                }}
              />
              <div
                className="absolute left-1/2 top-1/4 transform -translate-x-1/2"
                style={{
                  width: 8,
                  height: 18,
                  background: 'radial-gradient(ellipse at 50% 60%, #ffffff 0%, #fffacd 30%, #ffd700 60%, transparent 100%)',
                  borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                }}
              />
            </motion.div>
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(circle at 50% 40%, rgba(255,200,100,0.4) 0%, transparent 60%)',
                width: 200,
                height: 200,
                left: -80,
                top: -100,
              }}
              animate={{
                opacity: [0.6, 0.8, 0.5, 0.7, 0.6],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap"
        >
          <div className="bg-amber-900/90 text-amber-100 px-2 py-1 rounded text-xs font-medium shadow-lg">
            {currentPosition.label} · 点击切换
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default OilLamp;
