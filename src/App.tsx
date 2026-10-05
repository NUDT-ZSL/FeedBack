import React, { useEffect, useCallback, useReducer, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Slide from './Slide';
import {
  StoryState,
  StoryAction,
  StoryStore,
  SlideData,
  createInitialState,
  storyReducer,
  actionForKey,
  MAX_SLIDES
} from './state/storyState';
import {
  togglePresentation as togglePresentationService,
  domFullscreenPort
} from './state/presentation';

const App: React.FC = () => {
  const [story, dispatch] = useReducer(
    (state: StoryState, action: StoryAction) => storyReducer(state, action),
    undefined,
    () => createInitialState()
  );
  const { slides, currentIndex, direction, isPresentation } = story;

  // 供副作用回调读取最新状态（避免闭包过期）
  const storyRef = useRef(story);
  storyRef.current = story;

  // 与 DOM 无关的 Store 适配器，供演示模式服务驱动同一状态机
  const storeRef = useRef<StoryStore>({
    getState: () => storyRef.current,
    dispatch: (action: StoryAction) => {
      dispatch(action);
      return storyRef.current;
    }
  });

  const goToSlide = useCallback((newIndex: number) => {
    dispatch({ type: 'goToSlide', index: newIndex });
  }, []);

  const goNext = useCallback(() => {
    dispatch({ type: 'goNext' });
  }, []);

  const goPrev = useCallback(() => {
    dispatch({ type: 'goPrev' });
  }, []);

  const addSlide = useCallback(() => {
    dispatch({ type: 'addSlide' });
  }, []);

  const deleteSlide = useCallback((id: string) => {
    dispatch({ type: 'deleteSlide', id });
  }, []);

  const updateSlide = useCallback((id: string, updates: Partial<SlideData>) => {
    dispatch({ type: 'updateSlide', id, updates });
  }, []);

  const togglePresentation = useCallback(() => {
    void togglePresentationService(storeRef.current, domFullscreenPort);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = actionForKey(e.key, storyRef.current);
      if (!action) return;
      e.preventDefault();
      if (action.type === 'setPresentation') {
        // 演示模式下的 ESC / 空格：走服务以同步处理全屏退出
        togglePresentation();
      } else {
        dispatch(action);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePresentation]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && storyRef.current.isPresentation) {
        dispatch({ type: 'setPresentation', value: false });
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const currentSlide = slides[currentIndex];

  return (
    <div className="app-container">
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
          <button
            className="toolbar-btn"
            onClick={() => currentSlide && deleteSlide(currentSlide.id)}
            disabled={!currentSlide}
            title="删除当前幻灯片"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            删除当前页
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
          {!currentSlide && (
            <div className="empty-stage">暂无幻灯片，点击下方 + 新建</div>
          )}
        </div>
      </div>

      {!isPresentation && (
        <div className="navigation">
          <button
            className="nav-btn"
            onClick={goPrev}
            disabled={currentIndex <= 0}
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
              disabled={slides.length >= MAX_SLIDES}
              title={`新增幻灯片 (${slides.length}/${MAX_SLIDES})`}
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
            disabled={currentIndex >= slides.length - 1}
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
