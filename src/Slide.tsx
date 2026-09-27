import React, { useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import DataViz, { DataPoint } from './DataViz';

export interface SlideData {
  id: string;
  title: string;
  chartType: 'bar' | 'line';
  data: DataPoint[];
  note: string;
  noteFontSize: number;
}

interface SlideProps {
  slide: SlideData;
  direction: 'forward' | 'backward';
  isActive: boolean;
  isPresentation: boolean;
  onUpdate: (updates: Partial<SlideData>) => void;
}

const variants = {
  enter: (direction: 'forward' | 'backward') => ({
    x: direction === 'forward' ? 80 : -80,
    opacity: 0,
    scale: 0.96
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1
  },
  exit: (direction: 'forward' | 'backward') => ({
    x: direction === 'forward' ? -80 : 80,
    opacity: 0,
    scale: 0.96
  })
};

const Slide: React.FC<SlideProps> = ({ slide, direction, isPresentation, onUpdate }) => {
  const noteRef = useRef<HTMLDivElement>(null);

  const execCommand = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    noteRef.current?.focus();
  }, []);

  const handleNoteInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    onUpdate({ note: e.currentTarget.innerHTML });
  }, [onUpdate]);

  const handleFontSizeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate({ noteFontSize: parseInt(e.target.value, 10) });
  }, [onUpdate]);

  return (
    <motion.div
      className="slide-card"
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{
        x: { duration: 0.5, ease: [0.65, 0, 0.35, 1] },
        opacity: { duration: 0.35, ease: 'easeInOut' },
        scale: { duration: 0.5, ease: [0.65, 0, 0.35, 1] }
      }}
    >
      <div className="slide-header">
        {isPresentation ? (
          <h2 className="slide-title-input" style={{ padding: 0 }}>{slide.title}</h2>
        ) : (
          <input
            className="slide-title-input"
            type="text"
            placeholder="输入幻灯片标题..."
            value={slide.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
          />
        )}
        {!isPresentation && (
          <div className="chart-type-toggle">
            <button
              className={`chart-type-btn ${slide.chartType === 'bar' ? 'active' : ''}`}
              onClick={() => onUpdate({ chartType: 'bar' })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="20" x2="12" y2="10"></line>
                <line x1="18" y1="20" x2="18" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="16"></line>
              </svg>
              柱状图
            </button>
            <button
              className={`chart-type-btn ${slide.chartType === 'line' ? 'active' : ''}`}
              onClick={() => onUpdate({ chartType: 'line' })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 17 9 11 13 15 21 7"></polyline>
              </svg>
              折线图
            </button>
          </div>
        )}
      </div>

      <div className="slide-body">
        <div className="chart-section">
          <DataViz
            data={slide.data}
            chartType={slide.chartType}
            animateKey={slide.id}
          />
          {!isPresentation && (
            <div className="data-points-editor">
              {slide.data.map((point, idx) => (
                <div key={idx} className="data-point-input">
                  <label>{`#${idx + 1}`}</label>
                  <input
                    type="text"
                    value={point.label}
                    placeholder="标签"
                    onChange={(e) => {
                      const newData = [...slide.data];
                      newData[idx] = { ...point, label: e.target.value };
                      onUpdate({ data: newData });
                    }}
                  />
                  <input
                    type="number"
                    value={point.value}
                    placeholder="数值"
                    onChange={(e) => {
                      const newData = [...slide.data];
                      newData[idx] = { ...point, value: parseFloat(e.target.value) || 0 };
                      onUpdate({ data: newData });
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="note-section">
          {!isPresentation && (
            <div className="note-toolbar">
              <button
                className="format-btn bold"
                onClick={() => execCommand('bold')}
                title="粗体"
              >
                B
              </button>
              <button
                className="format-btn italic"
                onClick={() => execCommand('italic')}
                title="斜体"
              >
                I
              </button>
              <button
                className="format-btn"
                onClick={() => execCommand('insertUnorderedList')}
                title="无序列表"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"></line>
                  <line x1="8" y1="12" x2="21" y2="12"></line>
                  <line x1="8" y1="18" x2="21" y2="18"></line>
                  <line x1="3" y1="6" x2="3.01" y2="6"></line>
                  <line x1="3" y1="12" x2="3.01" y2="12"></line>
                  <line x1="3" y1="18" x2="3.01" y2="18"></line>
                </svg>
              </button>
              <div className="font-size-control">
                <label>字号</label>
                <input
                  type="range"
                  min="12"
                  max="32"
                  step="1"
                  value={slide.noteFontSize}
                  onChange={handleFontSizeChange}
                />
                <span className="font-size-value">{slide.noteFontSize}px</span>
              </div>
            </div>
          )}
          <div
            ref={noteRef}
            className="note-editor"
            contentEditable={!isPresentation}
            suppressContentEditableWarning
            onInput={handleNoteInput}
            style={{ fontSize: `${slide.noteFontSize}px` }}
            dangerouslySetInnerHTML={{
              __html: slide.note ||
                (isPresentation ? '' : '<span style="color:#94a3b8">在此处输入数据洞察与分析注释...<br/><br/>支持 <b>粗体</b>、<i>斜体</i>、列表等富文本格式。</span>')
            }}
          />
        </div>
      </div>
    </motion.div>
  );
};

export default Slide;
