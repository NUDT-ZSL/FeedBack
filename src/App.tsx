import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import Stage from './Stage';
import CharacterPanel from './CharacterPanel';
import { useStore } from './useStore';

const App: React.FC = () => {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const animFrameRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const localTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const baseStateRef = useRef<Map<number, { x: number; y: number; scale: number }>>(new Map());

  const {
    isPlaying,
    currentTime,
    actionQueue,
    characters,
    setIsPlaying,
    setCurrentTime,
    setCharacterPosition,
    setCharacterScale,
    setCharacterRotation,
    setCharacterFlipY,
    resetCharacterAnim,
  } = useStore();

  useEffect(() => {
    const updateDimensions = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setDimensions({ width, height });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const saveBaseState = useCallback(() => {
    baseStateRef.current.clear();
    characters.forEach((char, index) => {
      baseStateRef.current.set(index, {
        x: char.x,
        y: char.y,
        scale: char.scale,
      });
    });
  }, [characters]);

  const resetAllAnimations = useCallback(() => {
    characters.forEach((_char, index) => {
      resetCharacterAnim(index);
      const base = baseStateRef.current.get(index);
      if (base) {
        setCharacterPosition(index, base.x, base.y);
        setCharacterScale(index, base.scale);
      }
    });
  }, [characters, resetCharacterAnim, setCharacterPosition, setCharacterScale]);

  const updateAnimations = useCallback(() => {
    if (actionQueue.length === 0) return;

    const queueDuration = actionQueue.length * 2000;
    const relativeTime = localTimeRef.current % queueDuration;

    const animationStates = new Map<number, {
      dance: number; fight: number; flip: number }>();

    characters.forEach((_char, idx) => {
      animationStates.set(idx, { dance: 0, fight: 0, flip: 0 });
    });

    actionQueue.forEach((action, idx) => {
      const actionStart = idx * 2000;
      const actionProgress = Math.max(0, Math.min(1, (relativeTime - actionStart) / 2000));
      if (actionProgress > 0 && actionProgress <= 1) {
        const state = animationStates.get(action.characterIndex)!;
        if (action.type === 'dance') state.dance = Math.max(state.dance, actionProgress);
        if (action.type === 'fight') state.fight = Math.max(state.fight, actionProgress);
        if (action.type === 'flip') state.flip = Math.max(state.flip, actionProgress);
      }
    });

    characters.forEach((char, index) => {
      const base = baseStateRef.current.get(index);
      if (!base) {
        baseStateRef.current.set(index, { x: char.x, y: char.y, scale: char.scale });
        return;
      }

      const anim = animationStates.get(index)!;
      let finalX = base.x;
      let finalY = base.y;
      let finalScale = base.scale;
      let finalRotation = 0;
      let finalFlipY = 0;

      if (anim.dance > 0) {
        const t = anim.dance;
        const swing = Math.sin(t * Math.PI * 4) * 20;
        const pulse = 1 + Math.sin(t * Math.PI * 4) * 0.1;
        finalX = base.x + swing;
        finalScale = base.scale * pulse;
      }

      if (anim.fight > 0) {
        const t = anim.fight;
        finalRotation = t * 360;
        finalX = base.x + Math.sin(t * Math.PI * 2) * 10;
        finalY = base.y + Math.cos(t * Math.PI * 2) * 5;
      }

      if (anim.flip > 0) {
        const t = anim.flip;
        finalFlipY = t < 0.5 ? t * 2 : (1 - t) * 2;
        finalY = base.y - Math.sin(t * Math.PI) * 60;
        finalRotation = t * 360;
      }

      setCharacterPosition(index, finalX, finalY);
      setCharacterScale(index, finalScale);
      setCharacterRotation(index, finalRotation);
      setCharacterFlipY(index, finalFlipY);
    });
  }, [actionQueue, characters, setCharacterPosition, setCharacterScale, setCharacterRotation, setCharacterFlipY]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = undefined;
      }
      resetAllAnimations();
      return;
    }

    saveBaseState();
    localTimeRef.current = 0;
    setCurrentTime(0);
    lastTimeRef.current = 0;

    const animate = (timestamp: number) => {
      if (!isPlayingRef.current) return;

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }

      const deltaTime = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      localTimeRef.current += deltaTime;

      const startTime = performance.now();
      setCurrentTime(localTimeRef.current);
      updateAnimations();
      const renderTime = performance.now() - startTime;

      if (renderTime > 5) {
        console.warn(`Animation frame took ${renderTime.toFixed(2)}ms, target < 5ms`);
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying, setCurrentTime, updateAnimations, saveBaseState, resetAllAnimations]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (actionQueue.length === 0) return;
      saveBaseState();
      localTimeRef.current = 0;
      setCurrentTime(0);
      setIsPlaying(true);
    }
  };

  const queueDuration = actionQueue.length * 2000;
  const progress = queueDuration > 0 ? ((currentTime % queueDuration) / queueDuration) * 100 : 0;

  const stageWidth = Math.floor(dimensions.width * 0.7);
  const stageHeight = dimensions.height - 70;
  const panelWidth = dimensions.width - stageWidth;

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#2c1e0e',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          position: 'absolute',
          top: '8px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 700,
            color: '#ffd700',
            fontFamily: "'ZCOOL XiaoWei', 'Noto Serif SC', serif",
            textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(255,215,0,0.3)',
            letterSpacing: '8px',
            margin: 0,
          }}
        >
          皮影幻戏台
        </h1>
      </header>

      <div
        style={{
          flex: 1,
          display: 'flex',
          paddingTop: '40px',
          paddingBottom: '70px',
          minHeight: 0,
        }}
      >
        <div
          style={{
            width: stageWidth,
            height: '100%',
            position: 'relative',
          }}
        >
          <Stage stageWidth={stageWidth} stageHeight={stageHeight} />
        </div>

        <div
          style={{
            width: panelWidth,
            height: '100%',
            minWidth: '280px',
          }}
        >
          <CharacterPanel currentTime={currentTime} />
        </div>
      </div>

      <motion.div
        initial={{ y: 70 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '70px',
          background: 'linear-gradient(0deg, #1a0f06 0%, #3e2723 100%)',
          borderTop: '3px solid #5d3a1a',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: '20px',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={togglePlay}
            disabled={!isPlaying && actionQueue.length === 0}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: isPlaying ? '#c62828' : '#2e7d32',
              border: 'none',
              color: '#fff',
              fontSize: '20px',
              cursor: isPlaying || actionQueue.length > 0 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isPlaying
                ? '0 4px 12px rgba(198, 40, 40, 0.5)'
                : '0 4px 12px rgba(46, 125, 50, 0.5)',
              transition: 'all 0.2s ease',
              opacity: !isPlaying && actionQueue.length === 0 ? 0.4 : 1,
              padding: 0,
              lineHeight: 1,
            }}
          >
            {isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </motion.button>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: '#a1887f',
              marginBottom: '6px',
            }}
          >
            <span>{isPlaying ? '正在演绎...' : actionQueue.length > 0 ? '准备就绪' : '请编排动作'}</span>
            <span>
              {queueDuration > 0
                ? `${((currentTime % queueDuration) / 1000).toFixed(1)}s / ${(queueDuration / 1000).toFixed(1)}s`
                : '0.0s / 0.0s'}
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '10px',
              background: '#3e2723',
              borderRadius: '5px',
              overflow: 'hidden',
              position: 'relative',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)',
            }}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.1, ease: 'linear' }}
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #ff8c00 0%, #ffd700 50%, #ff8c00 100%)',
                borderRadius: '5px',
                boxShadow: '0 0 10px rgba(255, 215, 0, 0.6)',
              }}
            />
            {actionQueue.map((action, index) => {
              const markerPos = ((index * 2000) / queueDuration) * 100;
              return (
                <div
                  key={action.id}
                  style={{
                    position: 'absolute',
                    left: `${markerPos}%`,
                    top: 0,
                    bottom: 0,
                    width: '2px',
                    background: 'rgba(255, 215, 0, 0.4)',
                  }}
                />
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#8d6e63',
            fontSize: '11px',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '16px' }}>🎭</span>
          <span>皮影戏师傅</span>
        </div>
      </motion.div>
    </div>
  );
};

export default App;
