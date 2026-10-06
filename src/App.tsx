import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import Stage from './Stage';
import CharacterPanel from './CharacterPanel';
import { useStore, getTimelineTotal } from './useStore';

const App: React.FC = () => {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const animFrameRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);

  const {
    isPlaying,
    currentTime,
    actionQueue,
    setIsPlaying,
    captureBase,
    resetPlayback,
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

  // 姿态合成规则（同一角色多个动作时间区间重叠时）：
  //   位移 dx/dy 逐动作累加；缩放系数连乘；旋转角度累加；垂直翻转取最大值。
  // 每个动作只作用于自己所属的角色，不同角色之间互不干扰。
  const updateAnimations = useCallback(() => {
    const state = useStore.getState();
    const { actionQueue: queue, characters: chars, baseCharacters } = state;
    const total = getTimelineTotal(queue);
    if (total <= 0 || !baseCharacters) return;

    // 当前时刻在时间轴上的位置（循环播放）
    const relativeTime = state.currentTime % total;

    const composed = chars.map(() => ({
      dx: 0,
      dy: 0,
      scaleMul: 1,
      rotation: 0,
      flipY: 0,
    }));

    queue.forEach((action) => {
      if (action.duration <= 0) return;
      const start = action.startTime;
      const end = start + action.duration;
      if (relativeTime < start || relativeTime >= end) return;
      const t = (relativeTime - start) / action.duration;
      const acc = composed[action.characterIndex];

      if (action.type === 'dance') {
        acc.dx += Math.sin(t * Math.PI * 4) * 20;
        acc.scaleMul *= 1 + Math.sin(t * Math.PI * 4) * 0.1;
      }
      if (action.type === 'fight') {
        acc.rotation += t * 360;
        acc.dx += Math.sin(t * Math.PI * 2) * 10;
        acc.dy += Math.cos(t * Math.PI * 2) * 5;
      }
      if (action.type === 'flip') {
        acc.flipY = Math.max(acc.flipY, t < 0.5 ? t * 2 : (1 - t) * 2);
        acc.dy -= Math.sin(t * Math.PI) * 60;
        acc.rotation += t * 360;
      }
    });

    chars.forEach((_char, index) => {
      const base = baseCharacters[index];
      const acc = composed[index];
      state.setCharacterPosition(index, base.x + acc.dx, base.y + acc.dy);
      state.setCharacterScale(index, base.scale * acc.scaleMul);
      state.setCharacterRotation(index, acc.rotation);
      state.setCharacterFlipY(index, acc.flipY);
    });
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = undefined;
      }
      // 暂停：姿态定格在当前帧，currentTime 保留，再次播放从当前进度继续。
      return;
    }

    captureBase();
    lastTimeRef.current = 0;

    const animate = (timestamp: number) => {
      if (!isPlayingRef.current) return;

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }

      const deltaTime = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      const startTime = performance.now();
      const state = useStore.getState();
      const total = getTimelineTotal(state.actionQueue);
      if (total <= 0) {
        isPlayingRef.current = false;
        state.resetPlayback();
        return;
      }
      // 以 store 中的 currentTime 为唯一时钟源推进，
      // 播放中编辑队列时对 currentTime 的映射调整可无缝生效。
      state.setCurrentTime((state.currentTime + deltaTime) % total);
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
  }, [isPlaying, captureBase, resetPlayback, updateAnimations]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (actionQueue.length === 0) return;
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    resetPlayback();
  };

  const queueDuration = getTimelineTotal(actionQueue);
  const relativeTime = queueDuration > 0 ? currentTime % queueDuration : 0;
  const progress = queueDuration > 0 ? (relativeTime / queueDuration) * 100 : 0;

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
          <CharacterPanel currentTime={relativeTime} />
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

          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={handleStop}
            disabled={!isPlaying && currentTime === 0}
            title="停止并复位"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: '#6d4c41',
              border: 'none',
              color: '#fff',
              fontSize: '20px',
              cursor: isPlaying || currentTime > 0 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
              transition: 'all 0.2s ease',
              opacity: isPlaying || currentTime > 0 ? 1 : 0.4,
              padding: 0,
              lineHeight: 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
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
            <span>{isPlaying ? '正在演绎...' : actionQueue.length > 0 ? (currentTime > 0 ? '已暂停' : '准备就绪') : '请编排动作'}</span>
            <span>
              {queueDuration > 0
                ? `${(relativeTime / 1000).toFixed(1)}s / ${(queueDuration / 1000).toFixed(1)}s`
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
            {queueDuration > 0 &&
              actionQueue.map((action) => {
                const markerPos = (action.startTime / queueDuration) * 100;
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
