import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store';

const Censer = () => {
  const isBurning = useStore(state => state.isBurning);
  const incenseOnCenser = useStore(state => state.incenseOnCenser);
  const incenseColor = useStore(state => state.incenseColor);
  const smokeParticles = useStore(state => state.smokeParticles);
  const aromaScore = useStore(state => state.aromaScore);
  const burntime = useStore(state => state.burntime);
  const ignite = useStore(state => state.ignite);
  const tick = useStore(state => state.tick);
  const placeIncenseOnCenser = useStore(state => state.placeIncenseOnCenser);
  const hasIncense = useStore(state => state.hasIncense);

  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!isBurning) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const animate = (timestamp: number) => {
      if (timestamp - lastTickRef.current >= 100) {
        tick();
        lastTickRef.current = timestamp;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isBurning, tick]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('incense');
    if (data === 'true' && hasIncense && !incenseOnCenser) {
      placeIncenseOnCenser();
    }
  };

  const canIgnite = incenseOnCenser && !isBurning;

  return (
    <div className="flex flex-col items-center gap-4">
      <h2 className="text-xl font-bold" style={{ color: '#d4a017', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
        鎏金铜香炉
      </h2>

      <div 
        className="relative"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          filter: isBurning ? 'brightness(1.05)' : 'none',
          transition: 'filter 0.5s ease',
        }}
      >
        <div className="relative" style={{ width: 140, height: 180 }}>
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2"
            style={{
              width: 120,
              height: 100,
              background: 'linear-gradient(180deg, #c9a227 0%, #d4a017 20%, #b8860b 50%, #8b6914 100%)',
              borderRadius: '0 0 60px 60px',
              border: '2px solid rgba(139,111,71,0.8)',
              boxShadow: 'inset 0 -10px 20px rgba(0,0,0,0.4), 0 8px 20px rgba(0,0,0,0.5)',
            }}
          />

          <div
            className="absolute"
            style={{
              bottom: 5,
              left: 10,
              width: 15,
              height: 40,
              background: 'linear-gradient(180deg, #d4a017 0%, #8b6914 100%)',
              borderRadius: '0 0 8px 8px',
              transform: 'rotate(-15deg)',
              boxShadow: '2px 0 4px rgba(0,0,0,0.3)',
            }}
          />
          <div
            className="absolute"
            style={{
              bottom: 5,
              right: 10,
              width: 15,
              height: 40,
              background: 'linear-gradient(180deg, #d4a017 0%, #8b6914 100%)',
              borderRadius: '0 0 8px 8px',
              transform: 'rotate(15deg)',
              boxShadow: '-2px 0 4px rgba(0,0,0,0.3)',
            }}
          />
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: 5,
              width: 15,
              height: 35,
              background: 'linear-gradient(180deg, #d4a017 0%, #8b6914 100%)',
              borderRadius: '0 0 8px 8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}
          />

          <div
            className="absolute bottom-24 left-1/2 -translate-x-1/2"
            style={{
              width: 130,
              height: 20,
              background: 'linear-gradient(180deg, #e6c200 0%, #d4a017 50%, #b8860b 100%)',
              borderRadius: '50%',
              border: '2px solid rgba(139,111,71,0.8)',
              boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
            }}
          />

          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: 0,
              width: 100,
              height: 60,
              background: 'linear-gradient(180deg, #e6c200 0%, #d4a017 30%, #b8860b 70%, #8b6914 100%)',
              borderRadius: '50% 50% 30% 30%',
              border: '2px solid rgba(139,111,71,0.8)',
              boxShadow: 'inset 0 -5px 15px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.4)',
              overflow: 'hidden',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background: `
                  repeating-linear-gradient(
                    0deg,
                    transparent,
                    transparent 8px,
                    rgba(139,111,71,0.6) 8px,
                    rgba(139,111,71,0.6) 10px
                  ),
                  repeating-linear-gradient(
                    90deg,
                    transparent,
                    transparent 8px,
                    rgba(139,111,71,0.6) 8px,
                    rgba(139,111,71,0.6) 10px
                  )
                `,
                opacity: 0.7,
              }}
            />
            <div
              className="absolute top-2 left-1/2 -translate-x-1/2"
              style={{
                width: 20,
                height: 15,
                background: 'linear-gradient(180deg, #e6c200 0%, #d4a017 100%)',
                borderRadius: '50% 50% 30% 30%',
                border: '1px solid rgba(139,111,71,0.8)',
              }}
            />
          </div>

          <AnimatePresence>
            {incenseOnCenser && (
              <motion.div
                className="absolute z-10"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }}
                style={{
                  left: '50%',
                  top: 65,
                  transform: 'translateX(-50%)',
                }}
              >
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: '12px solid transparent',
                    borderRight: '12px solid transparent',
                    borderBottom: `36px solid ${incenseColor}`,
                    filter: isBurning 
                      ? `drop-shadow(0 0 8px rgba(255,200,100,0.8))` 
                      : 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
                  }}
                />
                {isBurning && (
                  <motion.div
                    className="absolute -top-1 left-1/2 -translate-x-1/2"
                    animate={{
                      opacity: [0.8, 1, 0.8],
                      scale: [1, 1.2, 1],
                    }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                    }}
                    style={{
                      width: 8,
                      height: 8,
                      background: 'radial-gradient(circle, #ffd700 0%, #ff8c00 50%, transparent 100%)',
                      borderRadius: '50%',
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {isBurning && (
            <div
              className="absolute pointer-events-none z-20"
              style={{
                left: '50%',
                top: -20,
                transform: 'translateX(-50%)',
                width: 200,
                height: 300,
              }}
            >
              {smokeParticles.map(particle => (
                <motion.div
                  key={particle.id}
                  className="absolute rounded-full"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: particle.opacity,
                    scale: 1,
                  }}
                  transition={{ duration: 0.1 }}
                  style={{
                    left: `${particle.x}%`,
                    top: `${particle.y}px`,
                    width: particle.diameter,
                    height: particle.diameter,
                    background: `radial-gradient(circle, ${particle.color}aa 0%, ${particle.color}44 70%, transparent 100%)`,
                    transform: 'translate(-50%, -50%)',
                    filter: 'blur(2px)',
                    willChange: 'transform, opacity',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <motion.button
        onClick={ignite}
        disabled={!canIgnite}
        className="px-8 py-3 rounded-lg font-bold text-lg transition-all"
        whileHover={canIgnite ? { scale: 1.05 } : {}}
        whileTap={canIgnite ? { scale: 0.95 } : {}}
        style={{
          background: canIgnite
            ? 'linear-gradient(135deg, #ff6b35 0%, #d32f2f 100%)'
            : 'linear-gradient(135deg, #5a5a5a 0%, #3a3a3a 100%)',
          color: canIgnite ? '#fff' : '#8a8a8a',
          border: `2px solid ${canIgnite ? '#ff6b35' : '#5a5a5a'}`,
          boxShadow: canIgnite ? '0 4px 12px rgba(255,107,53,0.4)' : 'none',
          cursor: canIgnite ? 'pointer' : 'not-allowed',
        }}
      >
        点燃
      </motion.button>

      <div
        className="p-4 rounded-lg w-full"
        style={{
          background: 'linear-gradient(180deg, rgba(58,42,26,0.9) 0%, rgba(42,30,18,0.9) 100%)',
          border: '2px solid #d4a017',
        }}
      >
        <div className="text-center text-sm mb-2" style={{ color: '#d4a017' }}>
          香气持久度
        </div>
        <div className="text-center text-3xl font-bold mb-3" style={{ color: '#f5f5dc' }}>
          {aromaScore}
        </div>
        <div className="h-4 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <motion.div
            className="h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${aromaScore}%` }}
            transition={{ duration: 0.3 }}
            style={{
              background: 'linear-gradient(90deg, #4a2e1b 0%, #d4a017 100%)',
            }}
          />
        </div>
        {isBurning && (
          <div className="text-center text-xs mt-2" style={{ color: 'rgba(245,245,220,0.6)' }}>
            已燃烧: {(burntime / 10).toFixed(1)} 秒
          </div>
        )}
      </div>

      {!incenseOnCenser && hasIncense && (
        <div className="text-xs text-center" style={{ color: 'rgba(212,160,23,0.8)' }}>
          将合香拖放到此处
        </div>
      )}
    </div>
  );
};

export default Censer;
