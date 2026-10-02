import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, CHARACTER_NAMES, CHARACTER_COLORS, ActionType, ActionItem } from './useStore';

interface CharacterPanelProps {
  currentTime: number;
}

const actionLabels: Record<ActionType, string> = {
  dance: '跳舞',
  fight: '耍棍',
  flip: '翻筋斗',
};

const CharacterPanel: React.FC<CharacterPanelProps> = ({ currentTime }) => {
  const {
    selectedCharacter,
    characters,
    actionQueue,
    setSelectedCharacter,
    setCharacterPosition,
    setCharacterScale,
    addAction,
    removeAction,
    reorderActions,
  } = useStore();

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragOverIndex = useRef<number | null>(null);

  const handleCharacterSelect = (index: number) => {
    if (selectedCharacter === index) {
      setSelectedCharacter(null);
    } else {
      setSelectedCharacter(index);
      const char = characters[index];
      if (char.x === 0 && char.y === 0) {
        setCharacterPosition(index, 0, 0);
      }
    }
  };

  const handlePositionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedCharacter === null) return;
    const x = parseFloat(e.target.value);
    const y = characters[selectedCharacter].y;
    setCharacterPosition(selectedCharacter, x, y);
  };

  const handleYChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedCharacter === null) return;
    const x = characters[selectedCharacter].x;
    const y = parseFloat(e.target.value);
    setCharacterPosition(selectedCharacter, x, y);
  };

  const handleScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedCharacter === null) return;
    const scale = parseFloat(e.target.value);
    setCharacterScale(selectedCharacter, scale);
  };

  const handleActionClick = (type: ActionType) => {
    if (selectedCharacter === null) return;
    addAction(selectedCharacter, type);
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverIndex.current = index;
  };

  const handleDragEnd = () => {
    if (dragIndex !== null && dragOverIndex.current !== null && dragIndex !== dragOverIndex.current) {
      reorderActions(dragIndex, dragOverIndex.current);
    }
    setDragIndex(null);
    dragOverIndex.current = null;
  };

  const getActionProgress = (action: ActionItem): number => {
    const queueDuration = actionQueue.length * 2000;
    if (queueDuration === 0) return 0;

    const actionStartTime = actionQueue.indexOf(action) * 2000;
    let relativeTime = currentTime % queueDuration;
    if (relativeTime < 0) relativeTime += queueDuration;

    const actionEndTime = actionStartTime + 2000;
    if (relativeTime >= actionStartTime && relativeTime < actionEndTime) {
      return (relativeTime - actionStartTime) / 2000;
    }
    return 0;
  };

  const getRemainingTime = (action: ActionItem): number => {
    const progress = getActionProgress(action);
    return Math.max(0, Math.ceil((1 - progress) * 2));
  };

  const isActionActive = (action: ActionItem): boolean => {
    return getActionProgress(action) > 0;
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        background: 'linear-gradient(180deg, #3e2723 0%, #2c1e0e 100%)',
        borderLeft: '3px solid #5d3a1a',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <h2
        style={{
          fontSize: '20px',
          fontWeight: 700,
          color: '#ffd700',
          marginBottom: '16px',
          textAlign: 'center',
          fontFamily: "'ZCOOL XiaoWei', serif",
          textShadow: '0 2px 4px rgba(0,0,0,0.5)',
          letterSpacing: '2px',
        }}
      >
        皮影角色
      </h2>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        {CHARACTER_NAMES.map((name, index) => {
          const color = CHARACTER_COLORS[index];
          const isSelected = selectedCharacter === index;
          const char = characters[index];
          const isActive = char.x !== 0 || char.y !== 0 || char.scale !== 1.0;

          return (
            <motion.div
              key={index}
              onClick={() => handleCharacterSelect(index)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px',
                background: isSelected
                  ? 'linear-gradient(135deg, rgba(230, 126, 34, 0.3) 0%, rgba(255, 215, 0, 0.15) 100%)'
                  : 'rgba(93, 58, 26, 0.4)',
                borderRadius: '10px',
                border: `2px solid ${isSelected ? '#ffd700' : isActive ? '#e67e22' : '#5d4037'}`,
                cursor: 'pointer',
                minHeight: '64px',
                boxShadow: isSelected
                  ? '0 4px 12px rgba(255, 215, 0, 0.3)'
                  : '0 2px 6px rgba(0, 0, 0, 0.2)',
                transition: 'all 0.2s ease',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: `radial-gradient(circle at 30% 30%, ${color}, ${color}dd)`,
                  border: `3px solid #e67e22`,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.2)',
                  position: 'relative',
                }}
              >
                <svg width="36" height="36" viewBox="0 0 50 90" fill="#000" style={{ opacity: 0.85 }}>
                  <path d={index === 0
                    ? "M 25 5 Q 30 2 35 8 Q 40 5 42 12 Q 38 18 32 20 Q 28 22 25 25 Q 22 22 18 20 Q 12 18 8 12 Q 10 5 15 8 Q 20 2 25 5 M 18 25 Q 15 35 12 50 Q 10 60 15 70 Q 20 75 25 72 Q 30 75 35 70 Q 40 60 38 50 Q 35 35 32 25 M 8 40 Q 2 45 5 55 Q 8 60 15 55 Q 18 50 15 45 Q 12 40 8 40 M 42 40 Q 48 45 45 55 Q 42 60 35 55 Q 32 50 35 45 Q 38 40 42 40 M 22 72 Q 18 80 20 88 Q 22 90 24 88 Q 25 82 25 75 M 28 72 Q 32 80 30 88 Q 28 90 26 88 Q 25 82 25 75"
                    : index === 1
                    ? "M 25 3 Q 32 0 38 6 Q 45 3 46 14 Q 40 22 32 25 Q 28 28 25 30 Q 22 28 18 25 Q 10 22 4 14 Q 5 3 12 6 Q 18 0 25 3 M 16 28 Q 12 40 10 55 Q 8 70 14 80 Q 20 85 25 82 Q 30 85 36 80 Q 42 70 40 55 Q 38 40 34 28 M 6 45 Q 0 52 3 62 Q 6 68 14 62 Q 18 55 14 50 Q 10 45 6 45 M 44 45 Q 50 52 47 62 Q 44 68 36 62 Q 32 55 36 50 Q 40 45 44 45 M 20 82 Q 15 86 17 92 Q 20 95 23 92 Q 25 88 25 85 M 30 82 Q 35 86 33 92 Q 30 95 27 92 Q 25 88 25 85"
                    : "M 25 8 Q 32 4 37 10 Q 44 7 46 16 Q 40 24 32 26 Q 28 28 25 30 Q 22 28 18 26 Q 10 24 4 16 Q 6 7 13 10 Q 18 4 25 8 M 15 28 Q 11 42 9 58 Q 7 72 13 82 Q 20 87 25 84 Q 30 87 37 82 Q 43 72 41 58 Q 39 42 35 28 M 5 42 Q -2 50 1 60 Q 4 66 12 60 Q 16 53 12 48 Q 8 42 5 42 M 45 42 Q 52 50 49 60 Q 46 66 38 60 Q 34 53 38 48 Q 42 42 45 42 M 22 84 Q 16 88 18 94 Q 21 96 24 94 Q 25 89 25 86 M 28 84 Q 34 88 32 94 Q 29 96 26 94 Q 25 89 25 86"
                  } />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: isSelected ? '#ffd700' : '#f5f0e6',
                    marginBottom: '2px',
                  }}
                >
                  {name}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: isActive ? '#2ecc71' : '#8d6e63',
                  }}
                >
                  {isActive ? '已登场' : '待命中'}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedCharacter !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              marginBottom: '20px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: 'rgba(93, 58, 26, 0.5)',
                borderRadius: '10px',
                padding: '16px',
                border: '1px solid #6d4c41',
              }}
            >
              <h3
                style={{
                  fontSize: '14px',
                  color: '#ffd700',
                  marginBottom: '12px',
                  fontWeight: 600,
                }}
              >
                竹签控制 - {CHARACTER_NAMES[selectedCharacter]}
              </h3>

              <div style={{ marginBottom: '14px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    color: '#d7ccc8',
                    marginBottom: '6px',
                  }}
                >
                  <span>横向位置</span>
                  <span>{characters[selectedCharacter].x.toFixed(0)} px</span>
                </div>
                <input
                  type="range"
                  min="-150"
                  max="150"
                  step="1"
                  value={characters[selectedCharacter].x}
                  onChange={handlePositionChange}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    color: '#d7ccc8',
                    marginBottom: '6px',
                  }}
                >
                  <span>纵向位置</span>
                  <span>{characters[selectedCharacter].y.toFixed(0)} px</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={characters[selectedCharacter].y}
                  onChange={handleYChange}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    color: '#d7ccc8',
                    marginBottom: '6px',
                  }}
                >
                  <span>尺寸缩放</span>
                  <span>{characters[selectedCharacter].scale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.01"
                  value={characters[selectedCharacter].scale}
                  onChange={handleScaleChange}
                  style={{ width: '100%' }}
                />
              </div>

              <h4
                style={{
                  fontSize: '13px',
                  color: '#ffd700',
                  marginBottom: '10px',
                  fontWeight: 600,
                }}
              >
                动作编排
              </h4>
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                {(['dance', 'fight', 'flip'] as ActionType[]).map((type) => (
                  <motion.button
                    key={type}
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleActionClick(type)}
                    style={{
                      flex: 1,
                      minWidth: '44px',
                      minHeight: '44px',
                      padding: '10px 12px',
                      background: '#8d6e63',
                      color: '#f5f0e6',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#a1887f';
                      e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#8d6e63';
                      e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
                    }}
                  >
                    {actionLabels[type]}
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <h3
        style={{
          fontSize: '16px',
          color: '#ffd700',
          marginBottom: '12px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '18px' }}>📜</span>
        动作队列
        <span style={{ fontSize: '12px', color: '#8d6e63', fontWeight: 400 }}>
          ({actionQueue.length} 个动作)
        </span>
      </h3>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          minHeight: '100px',
        }}
      >
        {actionQueue.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '30px 16px',
              color: '#6d4c41',
              fontSize: '13px',
              fontStyle: 'italic',
              background: 'rgba(93, 58, 26, 0.2)',
              borderRadius: '8px',
              border: '1px dashed #5d4037',
            }}
          >
            选择角色并点击动作按钮<br />
            开始编排您的皮影戏
          </div>
        ) : (
          <AnimatePresence>
            {actionQueue.map((action, index) => {
              const active = isActionActive(action);
              const progress = getActionProgress(action);

              return (
                <motion.div
                  key={action.id}
                  layout
                  initial={{ opacity: 0, y: -10 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    animation: 'fadeIn 0.3s ease',
                  }}
                  exit={{ opacity: 0, x: 50, transition: { duration: 0.2 } }}
                  transition={{ delay: 0 }}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: index % 2 === 0 ? '#4e342e' : '#5d4037',
                    borderRadius: '6px',
                    borderLeft: active
                      ? `3px solid #ffd700`
                      : `3px solid ${CHARACTER_COLORS[action.characterIndex]}`,
                    cursor: 'grab',
                    position: 'relative',
                    overflow: 'hidden',
                    minHeight: '44px',
                    userSelect: 'none',
                  }}
                >
                  {active && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${progress * 100}%`,
                        background: 'rgba(255, 215, 0, 0.15)',
                        transition: 'width 0.1s linear',
                      }}
                    />
                  )}

                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: CHARACTER_COLORS[action.characterIndex],
                      flexShrink: 0,
                      marginRight: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      fontWeight: 700,
                      color: '#fff',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                      zIndex: 1,
                    }}
                  >
                    {CHARACTER_NAMES[action.characterIndex][0]}
                  </div>

                  <div style={{ flex: 1, zIndex: 1 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: active ? '#ffd700' : '#f5f0e6',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {CHARACTER_NAMES[action.characterIndex]}
                      <span style={{ color: '#8d6e63', fontWeight: 400 }}>·</span>
                      {actionLabels[action.type]}
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: active ? '#ffd700' : '#a1887f',
                        marginTop: '2px',
                      }}
                    >
                      {active
                        ? `播放中 ${Math.ceil(progress * 100)}%`
                        : `剩余 ${getRemainingTime(action)} 秒`}
                    </div>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.2, rotate: 90 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAction(action.id);
                    }}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: '#c62828',
                      border: 'none',
                      color: '#fff',
                      fontSize: '16px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                      zIndex: 1,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </motion.button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default CharacterPanel;
