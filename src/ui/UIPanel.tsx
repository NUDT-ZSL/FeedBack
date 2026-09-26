import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useGameStore } from '../game/GameStore';
import { PipeType, COLORS, LEVEL_CONFIGS } from '../game/types';

const pipeNames: Record<PipeType, string> = {
  straight: '直管',
  curve: '弯管',
  tee: '三通',
  valve: '阀门',
};

const StarIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? COLORS.star : 'none'}>
    <path
      d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
      stroke={filled ? COLORS.star : COLORS.starEmpty}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PipeSVG: React.FC<{ type: PipeType; size?: number }> = ({ type, size = 48 }) => {
  const halfSize = size / 2;
  const pipeWidth = size * 0.3;

  const renderPipe = () => {
    switch (type) {
      case 'straight':
      case 'valve':
        return (
          <>
            <rect
              x={halfSize - pipeWidth / 2}
              y={4}
              width={pipeWidth}
              height={size - 8}
              fill="rgba(255,255,255,0.9)"
              stroke={COLORS.pipeStroke}
              strokeWidth="2"
              rx="2"
            />
            {type === 'valve' && (
              <>
                <circle
                  cx={halfSize}
                  cy={halfSize}
                  r={pipeWidth * 0.4}
                  fill="rgba(255,255,255,0.9)"
                  stroke={COLORS.pipeStroke}
                  strokeWidth="2"
                />
                <line
                  x1={halfSize - pipeWidth * 0.3}
                  y1={halfSize - pipeWidth * 0.3}
                  x2={halfSize + pipeWidth * 0.3}
                  y2={halfSize + pipeWidth * 0.3}
                  stroke="#666"
                  strokeWidth="1.5"
                />
                <line
                  x1={halfSize + pipeWidth * 0.3}
                  y1={halfSize - pipeWidth * 0.3}
                  x2={halfSize - pipeWidth * 0.3}
                  y2={halfSize + pipeWidth * 0.3}
                  stroke="#666"
                  strokeWidth="1.5"
                />
              </>
            )}
          </>
        );
      case 'curve':
        return (
          <path
            d={`M ${halfSize - pipeWidth / 2} 4 
                L ${halfSize - pipeWidth / 2} ${halfSize - pipeWidth / 2}
                Q ${halfSize - pipeWidth / 2} ${halfSize - pipeWidth / 2} ${halfSize - pipeWidth / 2} ${halfSize - pipeWidth / 2}
                L ${size - 4} ${halfSize - pipeWidth / 2}
                L ${size - 4} ${halfSize + pipeWidth / 2}
                L ${halfSize + pipeWidth / 2} ${halfSize + pipeWidth / 2}
                L ${halfSize + pipeWidth / 2} 4
                Z`}
            fill="rgba(255,255,255,0.9)"
            stroke={COLORS.pipeStroke}
            strokeWidth="2"
          />
        );
      case 'tee':
        return (
          <>
            <rect
              x={4}
              y={halfSize - pipeWidth / 2}
              width={size - 8}
              height={pipeWidth}
              fill="rgba(255,255,255,0.9)"
              stroke={COLORS.pipeStroke}
              strokeWidth="2"
              rx="2"
            />
            <rect
              x={halfSize - pipeWidth / 2}
              y={halfSize}
              width={pipeWidth}
              height={halfSize - 4}
              fill="rgba(255,255,255,0.9)"
              stroke={COLORS.pipeStroke}
              strokeWidth="2"
              rx="2"
            />
          </>
        );
    }
  };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {renderPipe()}
    </svg>
  );
};

interface PipeButtonProps {
  type: PipeType;
  selected: boolean;
  onClick: () => void;
  isMobile: boolean;
}

const PipeButton: React.FC<PipeButtonProps> = ({ type, selected, onClick, isMobile }) => {
  const [isPressed, setIsPressed] = useState(false);
  const buttonSize = isMobile ? 36 : 48;

  const handleClick = () => {
    setIsPressed(true);
    onClick();
    setTimeout(() => setIsPressed(false), 150);
  };

  return (
    <button
      onClick={handleClick}
      style={{
        width: buttonSize,
        height: buttonSize,
        padding: 0,
        border: selected ? '2px solid #FFD700' : '2px solid transparent',
        borderRadius: '8px',
        backgroundColor: selected ? 'rgba(255, 215, 0, 0.2)' : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: isPressed ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 150ms, background-color 150ms',
        position: 'relative',
      }}
      title={pipeNames[type]}
    >
      <PipeSVG type={type} size={isMobile ? 32 : 40} />
      <span
        style={{
          position: 'absolute',
          bottom: '-18px',
          fontSize: '10px',
          color: '#94A3B8',
          whiteSpace: 'nowrap',
        }}
      >
        {pipeNames[type]}
      </span>
    </button>
  );
};

export const UIPanel: React.FC = () => {
  const {
    currentLevel,
    steps,
    stars,
    selectedPipe,
    showHint,
    hintText,
    hintOpacity,
    isLevelComplete,
    levelConfigs,
    selectPipe,
    resetLevel,
    nextLevel,
    setHint,
  } = useGameStore();

  const [isMobile, setIsMobile] = useState(false);
  const lastHintTime = useRef(0);
  const uiUpdateRef = useRef<number>(0);
  const lastUiUpdate = useRef<number>(0);

  const currentConfig = levelConfigs[currentLevel];

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handlePipeSelect = useCallback(
    (type: PipeType) => {
      if (isLevelComplete) return;
      selectPipe(selectedPipe === type ? null : type);
    },
    [selectedPipe, selectPipe, isLevelComplete]
  );

  const handleReset = useCallback(() => {
    if (isLevelComplete) return;
    const now = Date.now();
    if (now - lastHintTime.current < 2000) return;
    lastHintTime.current = now;
    resetLevel();
  }, [resetLevel, isLevelComplete]);

  const handleNextLevel = useCallback(() => {
    if (currentLevel < LEVEL_CONFIGS.length - 1) {
      nextLevel();
    } else {
      setHint('恭喜通关所有关卡！');
    }
  }, [currentLevel, nextLevel, setHint]);

  const buttonSize = isMobile ? 36 : 48;
  const availablePipes = currentConfig?.availablePipes || [];

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '90%',
          maxWidth: '1200px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 20px',
          backgroundColor: COLORS.stoneBg,
          border: `2px solid ${COLORS.stoneBorder}`,
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 10,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontFamily: "'Georgia', serif",
            fontSize: isMobile ? '16px' : '20px',
            fontWeight: 'bold',
            color: '#5D4037',
            flex: 1,
          }}
        >
          第 {currentLevel + 1} 关：{currentConfig?.name}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flex: 1,
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontFamily: "'Georgia', serif",
              fontSize: isMobile ? '14px' : '16px',
              color: '#5D4037',
            }}
          >
            步数: {steps}/{currentConfig?.maxSteps || 0}
          </span>
          <div style={{ display: 'flex', gap: '2px' }}>
            {[1, 2, 3].map((i) => (
              <StarIcon key={i} filled={stars >= i} />
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={handleReset}
            style={{
              padding: isMobile ? '6px 12px' : '8px 16px',
              fontSize: isMobile ? '12px' : '14px',
              backgroundColor: COLORS.stoneBg,
              border: `2px solid ${COLORS.stoneBorder}`,
              borderRadius: '8px',
              color: '#5D4037',
              cursor: isLevelComplete ? 'not-allowed' : 'pointer',
              fontFamily: "'Georgia', serif",
              opacity: isLevelComplete ? 0.5 : 1,
              transition: 'all 150ms',
            }}
            disabled={isLevelComplete}
          >
            重置
          </button>
          {isLevelComplete && (
            <button
              onClick={handleNextLevel}
              style={{
                padding: isMobile ? '6px 12px' : '8px 16px',
                fontSize: isMobile ? '12px' : '14px',
                backgroundColor: COLORS.targetGold,
                border: `2px solid ${COLORS.stoneBorder}`,
                borderRadius: '8px',
                color: '#5D4037',
                cursor: 'pointer',
                fontFamily: "'Georgia', serif",
                fontWeight: 'bold',
                transition: 'all 150ms',
              }}
            >
              {currentLevel < LEVEL_CONFIGS.length - 1 ? '下一关' : '重新开始'}
            </button>
          )}
        </div>
      </div>

      {showHint && (
        <div
          style={{
            position: 'absolute',
            top: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: COLORS.hintText,
            fontSize: '12px',
            borderRadius: '4px',
            fontFamily: "'Georgia', serif",
            opacity: hintOpacity,
            transition: 'opacity 300ms',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          {hintText}
        </div>
      )}

      {isLevelComplete && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '24px 48px',
            backgroundColor: COLORS.stoneBg,
            border: `3px solid ${COLORS.targetGold}`,
            borderRadius: '12px',
            textAlign: 'center',
            zIndex: 30,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          }}
        >
          <h2
            style={{
              fontFamily: "'Georgia', serif",
              fontSize: isMobile ? '20px' : '28px',
              color: '#5D4037',
              margin: '0 0 12px 0',
            }}
          >
            🎉 通关成功！
          </h2>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '12px' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ transform: `scale(${stars >= i ? 1.2 : 1})`, transition: 'transform 300ms' }}>
                <StarIcon filled={stars >= i} />
              </div>
            ))}
          </div>
          <p
            style={{
              fontFamily: "'Georgia', serif",
              fontSize: isMobile ? '14px' : '16px',
              color: '#795548',
              margin: 0,
            }}
          >
            用了 {steps} 步完成
          </p>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '16px',
          backgroundColor: COLORS.toolbarBg,
          borderRadius: '12px',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: