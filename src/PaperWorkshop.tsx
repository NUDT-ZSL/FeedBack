import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkshopStore } from './store';
import { getMaterialLabel, getGradeColor, getGradeLabel, formatTimestamp, getPaperColorByDryness, calculateDryingTime } from './utils';
import type { MaterialType } from './types';
import './index.css';

const materials: { type: MaterialType; color: string; label: string }[] = [
  { type: 'chuPi', color: '#c49a6c', label: '楮皮' },
  { type: 'sangPi', color: '#d4b08a', label: '桑皮' },
  { type: 'maXianWei', color: '#b8a088', label: '麻纤维' },
];

export default function PaperWorkshop() {
  const {
    pulp,
    currentPaper,
    history,
    isAnimating,
    currentStep,
    isResetting,
    showScoreAnimation,
    finalScore,
    ripples,
    showWaterStain,
    isScooping,
    scoopProgress,
    addMaterial,
    startScooping,
    updateScoopProgress,
    finishScooping,
    startPressing,
    finishPressing,
    startDragging,
    placeOnDryingWall,
    updateDryness,
    finishDrying,
    addInspectionPoint,
    hideScoreAnimation,
    resetAll,
    loadHistory,
  } = useWorkshopStore();

  const [draggedPosition, setDraggedPosition] = useState<{ x: number; y: number } | null>(null);
  const [animatedScore, setAnimatedScore] = useState(0);
  const dryingRef = useRef<number | null>(null);
  const scoopRef = useRef<number | null>(null);
  const workshopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (isScooping) {
      const startTime = performance.now();
      const duration = 1200;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        updateScoopProgress(progress);

        if (progress < 1) {
          scoopRef.current = requestAnimationFrame(animate);
        } else {
          setTimeout(() => {
            finishScooping();
          }, 100);
        }
      };

      scoopRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (scoopRef.current) {
        cancelAnimationFrame(scoopRef.current);
      }
    };
  }, [isScooping, updateScoopProgress, finishScooping]);

  useEffect(() => {
    if (currentPaper?.stage === 'drying') {
      const startTime = performance.now();
      const duration = calculateDryingTime(currentPaper.pressLevel);

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        updateDryness(progress * 100);

        if (progress < 1) {
          dryingRef.current = requestAnimationFrame(animate);
        } else {
          finishDrying();
        }
      };

      dryingRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (dryingRef.current) {
        cancelAnimationFrame(dryingRef.current);
      }
    };
  }, [currentPaper?.stage, currentPaper?.pressLevel, updateDryness, finishDrying]);

  useEffect(() => {
    if (showScoreAnimation) {
      const startTime = performance.now();
      const duration = 600;
      const startValue = 0;
      const endValue = finalScore;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        setAnimatedScore(Math.round(startValue + (endValue - startValue) * easeProgress));

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    }
  }, [showScoreAnimation, finalScore]);

  const handlePress = useCallback(() => {
    if (isAnimating || currentStep !== 1) return;
    startPressing();

    setTimeout(() => {
      finishPressing();
    }, 500);
  }, [isAnimating, currentStep, startPressing, finishPressing]);

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (isAnimating || currentStep !== 2) return;
    startDragging();

    const updatePosition = (clientX: number, clientY: number) => {
      if (workshopRef.current) {
        const rect = workshopRef.current.getBoundingClientRect();
        setDraggedPosition({
          x: clientX - rect.left,
          y: clientY - rect.top,
        });
      }
    };

    if ('touches' in e) {
      updatePosition(e.touches[0].clientX, e.touches[0].clientY);
    } else {
      updatePosition(e.clientX, e.clientY);
    }
  }, [isAnimating, currentStep, startDragging]);

  const handleDragMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (currentPaper?.stage !== 'dragging') return;

    const updatePosition = (clientX: number, clientY: number) => {
      if (workshopRef.current) {
        const rect = workshopRef.current.getBoundingClientRect();
        setDraggedPosition({
          x: clientX - rect.left,
          y: clientY - rect.top,
        });
      }
    };

    if ('touches' in e) {
      updatePosition(e.touches[0].clientX, e.touches[0].clientY);
    } else {
      updatePosition(e.clientX, e.clientY);
    }
  }, [currentPaper?.stage]);

  const handleDragEnd = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (currentPaper?.stage !== 'dragging' || !workshopRef.current) return;

    let clientX: number, clientY: number;
    if ('changedTouches' in e) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const rect = workshopRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const dryingWallRect = {
      left: rect.width * 0.65,
      right: rect.width * 0.95,
      top: rect.height * 0.1,
      bottom: rect.height * 0.5,
    };

    if (
      x >= dryingWallRect.left &&
      x <= dryingWallRect.right &&
      y >= dryingWallRect.top &&
      y <= dryingWallRect.bottom
    ) {
      placeOnDryingWall();
    }

    setDraggedPosition(null);
  }, [currentPaper?.stage, placeOnDryingWall]);

  const handleInspect = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isAnimating || currentStep !== 3 || !currentPaper) return;
    if (currentPaper.inspectionPoints >= 10) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    addInspectionPoint(x, y);
  }, [isAnimating, currentStep, currentPaper, addInspectionPoint]);

  const getCurrentGrade = () => {
    if (finalScore >= 90) return 'excellent';
    if (finalScore >= 70) return 'good';
    if (finalScore >= 50) return 'medium';
    return 'poor';
  };

  return (
    <div
      ref={workshopRef}
      className="workshop-container"
      onMouseMove={handleDragMove}
      onMouseUp={handleDragEnd}
      onTouchMove={handleDragMove}
      onTouchEnd={handleDragEnd}
      style={{ touchAction: currentPaper?.stage === 'dragging' ? 'none' : 'auto' }}
    >
      <motion.button
        className="reset-button"
        onClick={resetAll}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        disabled={isAnimating || isResetting}
      >
        重新配料
      </motion.button>

      <h1 className="workshop-title">明代宣纸作坊</h1>

      <AnimatePresence>
        {!isResetting ? (
          <motion.div
            className="workshop-main"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
            transition={{ duration: 0.5 }}
          >
            <div className="work-area">
              <div className="press-section">
                <div className="press-table">
                  <div className="press-table-top">
                    压榨台
                    {currentPaper && currentStep >= 1 && currentStep <= 2 && (
                      <motion.div
                        className="wet-paper"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        style={{
                          backgroundColor: getPaperColorByDryness(currentPaper.dryness),
                        }}
                      >
                        {currentPaper.stage === 'pressed' && (
                          <div
                            className="drag-hint"
                            onMouseDown={handleDragStart}
                            onTouchStart={handleDragStart}
                          >
                            拖拽到晒纸墙
                          </div>
                        )}
                      </motion.div>
                    )}
                    <AnimatePresence>
                      {showWaterStain && (
                        <motion.div
                          className="water-stain"
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 0.6 }}
                          exit={{ opacity: 0, transition: { duration: 0.5 } }}
                          transition={{ duration: 0.5 }}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                  <motion.div
                    className="press-lever"
                    onClick={handlePress}
                    whileHover={currentStep === 1 && !isAnimating ? { scale: 1.05 } : {}}
                    whileTap={currentStep === 1 && !isAnimating ? { scale: 0.95 } : {}}
                    animate={currentPaper?.stage === 'pressing' ? { rotate: 45 } : { rotate: 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <div className="lever-handle" />
                    <div className="lever-arm" />
                  </motion.div>
                </div>
              </div>

              <div className="vat-section">
                <div className="paper-vat">
                  <div className="vat-content">
                    <div className="pulp-liquid" />
                    <div className="pulp-texture" />
                  </div>
                  <div className="vat-label">纸槽</div>
                </div>

                <div className="concentration-bar">
                  <div className="bar-label">纸浆浓度: {Math.round(pulp.concentration)}%</div>
                  <div className="bar-track">
                    <motion.div
                      className="bar-fill"
                      style={{ width: `${pulp.concentration}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>

                <div className="scoop-container">
                  <motion.div
                    className="scoop-screen"
                    onClick={() => currentStep === 0 && !isAnimating && startScooping()}
                    whileHover={currentStep === 0 && !isAnimating ? { scale: 1.05, boxShadow: '0 8px 20px rgba(0,0,0,0.2)' } : {}}
                    whileTap={currentStep === 0 && !isAnimating ? { scale: 0.95 } : {}}
                    animate={isScooping ? {
                      x: `${scoopProgress * 280 - 140}px`,
                      y: [0, -10, 0],
                    } : { x: 0, y: 0 }}
                    transition={isScooping ? {
                      x: { duration: 1.2, ease: 'easeInOut' },
                      y: { duration: 0.4, repeat: 2, repeatType: 'reverse' },
                    } : { duration: 0.2 }}
                  >
                    <div className="bamboo-weave">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="bamboo-strand" style={{ transform: `translateX(${i * 12}px)` }} />
                      ))}
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={`h-${i}`} className="bamboo-strand horizontal" style={{ transform: `translateY(${i * 14}px)` }} />
                      ))}
                    </div>
                    {isScooping && (
                      <motion.div
                        className="scooped-pulp"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: scoopProgress > 0.3 ? 1 : 0 }}
                        transition={{ duration: 0.3 }}
                      />
                    )}
                  </motion.div>
                  <div className="scoop-label">抄纸帘</div>
                </div>

                <div className="material-buttons">
                  {materials.map((m) => (
                    <div key={m.type} className="material-group">
                      <motion.button
                        className="material-btn"
                        style={{ backgroundColor: m.color }}
                        onClick={() => addMaterial(m.type, 5)}
                        whileHover={{ scale: 1.05, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                        whileTap={{ scale: 0.95 }}
                        disabled={isAnimating || currentStep > 0}
                      >
                        +
                      </motion.button>
                      <motion.button
                        className="material-btn subtract"
                        style={{ backgroundColor: m.color }}
                        onClick={() => addMaterial(m.type, -5)}
                        whileHover={{ scale: 1.05, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                        whileTap={{ scale: 0.95 }}
                        disabled={isAnimating || currentStep > 0}
                      >
                        -
                      </motion.button>
                      <span className="material-label">{m.label} ({pulp.materials[m.type]})</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="drying-section">
                <div className="drying-wall">
                  <div className="wall-label">晒纸墙</div>
                  <div className="wood-grills">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="grill-slat" />
                    ))}
                  </div>
                  {currentPaper?.stage === 'drying' && (
                    <motion.div
                      className="drying-paper"
                      initial={{ scale: 0.9, opacity: 0.8 }}
                      animate={{
                        scale: 1,
                        opacity: 1,
                        backgroundColor: getPaperColorByDryness(currentPaper.dryness),
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  )}
                  {currentPaper?.stage === 'drying' && (
                    <div className="drying-progress">
                      <div className="progress-label">干燥进度: {Math.round(currentPaper.dryness)}%</div>
                      <div className="progress-track">
                        <motion.div
                          className="progress-fill"
                          style={{ width: `${currentPaper.dryness}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {currentStep === 2 && !isAnimating && (
                    <div className="drop-hint">将纸坯拖拽到此处</div>
                  )}
                </div>
              </div>

              <div className="inspection-section">
                <div className="inspection-table">
                  <div className="table-label">质检台</div>
                  <div
                    className="inspection-area"
                    onClick={handleInspect}
                    style={{ cursor: currentStep === 3 && !isAnimating ? 'pointer' : 'default' }}
                  >
                    {currentPaper && currentStep >= 3 && (
                      <motion.div
                        className="finished-paper"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{
                          opacity: 1,
                          scale: 1,
                          backgroundColor: finalScore < 50 ? '#a08060' : '#f5e6cc',
                          borderColor: showScoreAnimation ? getGradeColor(getCurrentGrade()) : 'transparent',
                        }}
                        transition={{ duration: 0.3 }}
                      >
                        {ripples.map((ripple) => (
                          <motion.div
                            key={ripple.id}
                            className="ripple"
                            style={{ left: ripple.x, top: ripple.y }}
                            initial={{ scale: 0, opacity: 1 }}
                            animate={{ scale: 1, opacity: 0 }}
                            transition={{ duration: 0.8 }}
                          />
                        ))}
                        {currentStep === 3 && currentPaper.inspectionPoints < 10 && (
                          <div className="inspect-hint">
                            点击检测 ({currentPaper.inspectionPoints}/10)
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {draggedPosition && currentPaper?.stage === 'dragging' && (
                <motion.div
                  className="dragged-paper"
                  style={{
                    left: draggedPosition.x - 60,
                    top: draggedPosition.y - 80,
                    backgroundColor: getPaperColorByDryness(currentPaper.dryness),
                  }}
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: 0.7 }}
                />
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showScoreAnimation && (
                <motion.div
                  className="score-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={hideScoreAnimation}
                >
                  <motion.div
                    className="score-card"
                    initial={{ scale: 0.5, y: 50 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 15 }}
                    style={{ borderColor: getGradeColor(getCurrentGrade()) }}
                  >
                    <div className="score-label">质检得分</div>
                    <motion.div
                      className="score-number"
                      style={{ color: getGradeColor(getCurrentGrade()) }}
                    >
                      {animatedScore}
                    </motion.div>
                    <motion.div
                      className="grade-badge"
                      style={{
                        backgroundColor: getGradeColor(getCurrentGrade()),
                        color: getCurrentGrade() === 'poor' ? '#fff' : '#333',
                      }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.5, type: 'spring' }}
                    >
                      {getGradeLabel(getCurrentGrade())}
                    </motion.div>
                    <div className="score-detail">
                      <div>浓度: {Math.round(pulp.concentration)}%</div>
                      <div>均匀度: {Math.round(currentPaper?.uniformity || 0)}%</div>
                      <div>干燥度: {Math.round(currentPaper?.dryness || 0)}%</div>
                      <div>压榨度: {Math.round(currentPaper?.pressLevel || 0)}%</div>
                    </div>
                    <div className="close-hint">点击任意处关闭</div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="history-section">
              <div className="scroll-container">
                <div className="scroll-top" />
                <div className="scroll-content">
                  <h3 className="history-title">历史记录</h3>
                  {history.length === 0 ? (
                    <div className="empty-history">暂无记录，开始您的第一张宣纸吧</div>
                  ) : (
                    <div className="history-list">
                      <AnimatePresence>
                        {history.map((record, index) => (
                          <motion.div
                            key={record.id}
                            className="history-item"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                            transition={{ delay: index * 0.03, duration: 0.3 }}
                          >
                            <span className="history-time">{formatTimestamp(record.timestamp)}</span>
                            <span className="history-materials">
                              {Object.entries(record.materials)
                                .map(([key, value]) => `${getMaterialLabel(key)}${value}`)
                                .join(' · ')}
                            </span>
                            <span className="history-score">{record.score}分</span>
                            <span
                              className="history-grade"
                              style={{
                                backgroundColor: getGradeColor(record.grade),
                                color: record.grade === 'poor' ? '#fff' : '#333',
                              }}
                            >
                              {getGradeLabel(record.grade)}
                            </span>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
                <div className="scroll-bottom" />
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            className="resetting-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="resetting-text">重新配料中...</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
