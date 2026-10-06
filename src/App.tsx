import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import Stage from './Stage';
import CharacterPanel from './CharacterPanel';
import {
  useStore,
  computePoses,
  getTotalDuration,
  getActionEnd,
  CHARACTER_COLORS,
} from './useStore';

const EMPTY_POSES: (null)[] = [null, null, null];

const App: React.FC = () => {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const animFrameRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const localTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const hasPlayedRef = useRef<boolean>(false);
  const queueRef = useRef(useStore.getState().actionQueue);
  const charactersRef = useRef(useStore.getState().characters);
  const prevQueueRef = useRef(useStore.getState().actionQueue);

  const {
    isPlaying,
    currentTime,
    actionQueue,
    characters,
    setIsPlaying,
    setCurrentTime,
    setAnimPoses,
  } = useStore();

  useEffect(() => {
    queueRef.current = actionQueue;
  }, [actionQueue]);

  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const applyFrame = useCallback(
    (time: number) => {
      setCurrentTime(time);
      setAnimPoses(computePoses(queueRef.current, charactersRef.current, time));
    },
    [setCurrentTime, setAnimPoses]
  );

  // 队列编辑（新增/删除/调序/改时长）时，把当前播放位置平滑映射到新时间轴：
  // 正在播放的动作若仍存在，保持其进度比例落到新区间；若已被删除或处于空隙，
  // 则按原时刻就近夹取到新时间轴范围内。队列为空时整体复位到初始状态。
  useEffect(() => {
    const prevQueue = prevQueueRef.current;
    prevQueueRef.current = actionQueue;
    if (prevQueue === actionQueue) return;

    if (actionQueue.length === 0) {
      localTimeRef.current = 0;
      hasPlayedRef.current = false;
      setIsPlaying(false);
      setCurrentTime(0);
      setAnimPoses([...EMPTY_POSES]);
      return;
    }

    const newTotal = getTotalDuration(actionQueue);
    const oldTotal = getTotalDuration(prevQueue);
    const oldTime = oldTotal > 0 ? localTimeRef.current % oldTotal : 0;

    let newTime = 0;
    const activePrev = prevQueue.find(
      (a) => oldTime >= a.startTime && oldTime < getActionEnd(a)
    );
    if (activePrev) {
      const moved = actionQueue.find((a) => a.id === activePrev.id);
      if (moved) {
        const progress = (oldTime - activePrev.startTime) / activePrev.duration;
        newTime = moved.startTime + progress * moved.duration;
      } else {
        newTime = Math.min(oldTime, Math.max(0, newTotal - 1));
      }
    } else {
      newTime = Math.min(oldTime, Math.max(0, newTotal - 1));
    }

    localTimeRef.current = newTime;
    setCurrentTime(newTime);
    if (!isPlayingRef.current && hasPlayedRef.current) {
      setAnimPoses(computePoses(actionQueue, charactersRef.current, newTime));
    }
  }, [actionQueue, setIsPlaying, setCurrentTime, setAnimPoses]);

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = undefined;
      }
      return;
    }

    if (queueRef.current.length === 0) return;

    hasPlayedRef.current = true;
    lastTimeRef.current = 0;

    const animate = (timestamp: number) => {
      if (!isPlayingRef.current) return;

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }

      const deltaTime = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;
      localTimeRef.current += deltaTime;

      const total = getTotalDuration(queueRef.current);
      if (total <= 0) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const startTime = performance.now();
      applyFrame(localTimeRef.current % total);
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
  }, [isPlaying, applyFrame]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      const total = getTotalDuration(actionQueue);
      if (actionQueue.length === 0 || total <= 0) return;
      if (localTimeRef.current >= total || currentTime >= total) {
        localTimeRef.current = 0;
        setCurrentTime(0);
      } else {
        localTimeRef.current = currentTime;
      }
      setIsPlaying(true);
    }
  };

  const queueDuration = getTotalDuration(actionQueue);
  const progress = queueDuration > 0 ? (currentTime / queueDuration) * 100 : 0;

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
                ? `${(currentTime / 1000).toFixed(1)}s / ${(queueDuration / 1000).toFixed(1)}s`
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
            {queueDuration > 0 &&
              actionQueue.map((action) => (
                <div
                  key={action.id}
                  title={`${(action.startTime / 1000).toFixed(1)}s → ${(getActionEnd(action) / 1000).toFixed(1)}s`}
                  style={{
                    position: 'absolute',
                    left: `${(action.startTime / queueDuration) * 100}%`,
                    width: `${(action.duration / queueDuration) * 100}%`,
                    top: 0,
                    bottom: 0,
                    background: `${CHARACTER_COLORS[action.characterIndex]}55`,
                    borderLeft: '1px solid rgba(255, 215, 0, 0.4)',
                  }}
                />
              ))}
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.1, ease: 'linear' }}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: '100%',
                background: 'linear-gradient(90deg, rgba(255,140,0,0.55) 0%, rgba(255,215,0,0.55) 50%, rgba(255,140,0,0.55) 100%)',
                borderRadius: '5px',
                boxShadow: '0 0 10px rgba(255, 215, 0, 0.6)',
                pointerEvents: 'none',
              }}
            />
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
