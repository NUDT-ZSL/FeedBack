import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Slide, { SlideData } from './Slide';

const generateId = (): string => Math.random().toString(36).substring(2, 10);

const createInitialSlides = (): SlideData[] => [
  {
    id: generateId(),
    title: '2024年度销售额概览',
    chartType: 'bar',
    data: [
      { label: 'Q1', value: 128000 },
      { label: 'Q2', value: 156000 },
      { label: 'Q3', value: 189000 },
      { label: 'Q4', value: 234000 },
      { label: 'Q1', value: 278000 },
      { label: 'Q2', value: 312000 }
    ],
    note: '<b>关键洞察：</b>年度销售额呈现持续增长态势。<br/><br/><i>主要驱动因素：</i><ul><li>新产品线贡献显著</li><li>东南亚市场快速扩张</li><li>品牌溢价策略生效</li></ul>',
    noteFontSize: 16
  },
  {
    id: generateId(),
    title: '用户增长趋势分析',
    chartType: 'line',
    data: [
      { label: '1月', value: 12500 },
      { label: '2月', value: 15800 },
      { label: '3月', value: 19200 },
      { label: '4月', value: 24600 },
      { label: '5月', value: 31200 },
      { label: '6月', value: 38900 }
    ],
    note: '<b>月活用户突破 38K</b>，环比增长 24.7%。<br/><br/><i>增长亮点：</i><ul><li>病毒式传播活动效果显著</li><li>产品体验优化降低流失率</li><li>付费转化率提升至 4.2%</li></ul>',
    noteFontSize: 16
  },
  {
    id: generateId(),
    title: '产品品类销售分布',
    chartType: 'bar',
    data: [
      { label: 'A类', value: 45600 },
      { label: 'B类', value: 32100 },
      { label: 'C类', value: 28700 },
      { label: 'D类', value: 19800 },
      { label: 'E类', value: 15400 },
      { label: 'F类', value: 8200 }
    ],
    note: '<b>A类产品</b>贡献最大销售额，占比约 32%。<br/><br/><i>策略建议：</i><ul><li>加大A类产品投入</li><li>优化D/F类产品结构</li><li>探索品类交叉销售机会</li></ul>',
    noteFontSize: 16
  }
];

const App: React.FC = () => {
  const [slides, setSlides] = useState<SlideData[]>(createInitialSlides);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [isPresentation, setIsPresentation] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const goToSlide = useCallback((newIndex: number) => {
    if (newIndex < 0 || newIndex >= slides.length || newIndex === currentIndex) return;
    setDirection(newIndex > currentIndex ? 'forward' : 'backward');
    setCurrentIndex(newIndex);
  }, [currentIndex, slides.length]);

  const goNext = useCallback(() => {
    if (currentIndex < slides.length - 1) {
      setDirection('forward');
      setCurrentIndex(prev => prev + 1);
    }
  }, [currentIndex, slides.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection('backward');
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  const addSlide = useCallback(() => {
    if (slides.length >= 10) return;
    const newSlide: SlideData = {
      id: generateId(),
      title: `新幻灯片 ${slides.length + 1}`,
      chartType: 'bar',
      data: [
        { label: 'A', value: Math.floor(Math.random() * 50000) + 10000 },
        { label: 'B', value: Math.floor(Math.random() * 50000) + 10000 },
        { label: 'C', value: Math.floor(Math.random() * 50000) + 10000 },
        { label: 'D', value: Math.floor(Math.random() * 50000) + 10000 },
        { label: 'E', value: Math.floor(Math.random() * 50000) + 10000 },
        { label: 'F', value: Math.floor(Math.random() * 50000) + 10000 }
      ],
      note: '',
      noteFontSize: 16
    };
    setSlides(prev => [...prev, newSlide]);
    setDirection('forward');
    setCurrentIndex(slides.length);
  }, [slides.length]);

  const updateSlide = useCallback((id: string, updates: Partial<SlideData>) => {
    setSlides(prev => prev.map(slide =>
      slide.id === id ? { ...slide, ...updates } : slide
    ));
  }, []);

  const togglePresentation = useCallback(async () => {
    if (!isPresentation) {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
        setIsPresentation(true);
      } catch {
        setIsPresentation(true);
      }
    } else {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch { /* ignore */ }
      setIsPresentation(false);
    }
  }, [isPresentation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPresentation) {
        if (e.key === 'Escape' || e.key === ' ') {
          e.preventDefault();
          togglePresentation();
          return;
        }
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresentation, goNext, goPrev, togglePresentation]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isPresentation) {
        setIsPresentation(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isPresentation]);

  const currentSlide = slides[currentIndex];

  return (
    <div className="app-container" ref={containerRef}>
      <div className="app-header">
        <div className="app-logo">
          <span className="app-logo-dot" />
          Data Storyteller
        </div>
      </div>

      {!isPresentation && (
        <div className="toolbar">
          <button className="toolbar-btn" onClick={togglePresentation}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
              <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
              <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
              <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
            </svg>
            演示模式
          </button>
        </div>
      )}

      <div className="slide-stage">
        <div className="slide-wrapper">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            {currentSlide && (
              <Slide
                key={currentSlide.id}
                slide={currentSlide}
                direction={direction}
                isActive={true}
                isPresentation={isPresentation}
                onUpdate={(updates) => updateSlide(currentSlide.id, updates)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {!isPresentation && (
        <div className="navigation">
          <button
            className="nav-btn"
            onClick={goPrev}
            disabled={currentIndex === 0}
            title="上一张 (←)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>

          <div className="dots-container">
            {slides.map((slide, idx) => (
              <motion.button
                key={slide.id}
                className="nav-dot"
                onClick={() => goToSlide(idx)}
                animate={{
                  scale: idx === currentIndex ? 1.2 : 1,
                  backgroundColor: idx === currentIndex
                    ? '#7c3aed'
                    : '#334155',
                  boxShadow: idx === currentIndex
                    ? '0 0 10px rgba(124, 58, 237, 0.6)'
                    : '0 0 0 rgba(0,0,0,0)'
                }}
                transition={{
                  type: 'spring',
                  stiffness: 500,
                  damping: 25,
                  mass: 0.5
                }}
                title={`第 ${idx + 1} 张`}
              />
            ))}
            <button
              className="add-slide-btn"
              onClick={addSlide}
              disabled={slides.length >= 10}
              title={`新增幻灯片 (${slides.length}/10)`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>

          <span className="slide-counter">
            {String(currentIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
          </span>

          <button
            className="nav-btn"
            onClick={goNext}
            disabled={currentIndex === slides.length - 1}
            title="下一张 (→)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      )}

      <AnimatePresence>
        {isPresentation && currentSlide && (
          <motion.div
            className="presentation-mode"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={togglePresentation}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: 1100,
                aspectRatio: '16 / 9',
                height: 'auto',
                maxHeight: '100%'
              }}
            >
              <Slide
                key={`pres-${currentSlide.id}`}
                slide={currentSlide}
                direction={direction}
                isActive={true}
                isPresentation={true}
                onUpdate={() => {}}
              />
            </motion.div>
            <motion.div
              className="presentation-hint"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              <kbd>←</kbd> <kbd>→</kbd> 切换 · <kbd>ESC</kbd> 或 <kbd>空格</kbd> 退出
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
