import React, { useEffect, useRef, useState } from 'react';
import type { PrintRecord } from './types';
import {
  CELL_SIZE,
  CANVAS_PADDING,
  FONT_SIZE,
  GRID_COLS,
  GRID_ROWS,
  formatTimestamp
} from './utils/printUtils';
import { renderPrintFrame } from './utils/printEngine';
import { playRevealSound } from './utils/audio';

interface PrintResultProps {
  record: PrintRecord | null;
}

const PrintResult: React.FC<PrintResultProps> = ({ record }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const frame = record ? renderPrintFrame(record) : null;
  const characters = record?.characters ?? [];

  useEffect(() => {
    if (characters.length === 0) return;

    setRevealed(false);
    const timer = setTimeout(() => {
      setRevealed(true);
      playRevealSound();
    }, 300);

    return () => clearTimeout(timer);
  }, [record, characters.length]);

  useEffect(() => {
    if (!record || !frame || characters.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) {
      setShowFallback(true);
      return;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      setShowFallback(true);
      return;
    }

    const startTime = performance.now();

    const canvasWidth = CANVAS_PADDING * 2 + GRID_COLS * CELL_SIZE;
    const canvasHeight = CANVAS_PADDING * 2 + GRID_ROWS * CELL_SIZE;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    ctx.fillStyle = '#f5ebd4';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.globalAlpha = 0.05;
    frame.textureSpeckles.forEach(speckle => {
      ctx.fillStyle = speckle.dark ? '#8b7355' : '#d4c4a8';
      ctx.fillRect(speckle.x, speckle.y, 1, 1);
    });
    ctx.globalAlpha = 1;

    ctx.font = `600 ${FONT_SIZE}px "Noto Serif SC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#222222';

    frame.glyphs.forEach(glyph => {
      ctx.globalAlpha = glyph.opacity;
      ctx.fillText(glyph.char, glyph.x, glyph.y);

      if (glyph.ghost) {
        ctx.globalAlpha = frame.textOpacity * 0.3;
        ctx.fillText(glyph.char, glyph.ghostX, glyph.ghostY);
      }
    });

    ctx.globalAlpha = 1;

    const elapsed = performance.now() - startTime;
    console.log(`Canvas rendering completed in ${elapsed.toFixed(2)}ms`);

    if (elapsed > 50) {
      console.warn('Canvas rendering exceeded 50ms target');
    }
  }, [record, frame, characters.length]);

  if (!record || !frame || characters.length === 0) {
    return (
      <div className="typeplate-container" style={{ textAlign: 'center', padding: '40px' }}>
        <p style={{ color: '#f5ebd4', fontSize: '1.1rem' }}>
          完成排版、上墨和施压后，印刷成品将在此展示
        </p>
      </div>
    );
  }

  const renderFallback = () => (
    <div
      style={{
        padding: `${CANVAS_PADDING}px`,
        background: '#f5ebd4',
        fontFamily: '"Noto Serif SC", serif',
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_COLS}, ${CELL_SIZE}px)`,
        gridTemplateRows: `repeat(${GRID_ROWS}, ${CELL_SIZE}px)`,
        gap: 0
      }}
    >
      {Array.from({ length: GRID_ROWS * GRID_COLS }).map((_, idx) => {
        const row = Math.floor(idx / GRID_COLS);
        const col = idx % GRID_COLS;
        const glyph = frame.glyphs.find(g => g.row === row && g.col === col);

        return (
          <div
            key={idx}
            style={{
              width: CELL_SIZE,
              height: CELL_SIZE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: `${FONT_SIZE * 0.6}px`,
              fontWeight: 600,
              color: '#222222',
              opacity: glyph ? glyph.opacity : 0,
              transform: glyph
                ? `translate(${glyph.x - (CANVAS_PADDING + glyph.col * CELL_SIZE + CELL_SIZE / 2)}px, ${glyph.y - (CANVAS_PADDING + glyph.row * CELL_SIZE + CELL_SIZE / 2)}px)`
                : undefined
            }}
          >
            {glyph?.char || ''}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="typeplate-container">
      <h3 style={{ color: '#f5ebd4', marginBottom: '15px', textAlign: 'center' }}>
        印刷成品
      </h3>

      <div className="print-result-container">
        <div
          className="paper-canvas"
          style={{
            opacity: revealed ? 1 : 0,
            transition: 'opacity 0.5s ease-in-out',
            transform: revealed ? 'translateY(0)' : 'translateY(10px)'
          }}
        >
          {showFallback ? (
            renderFallback()
          ) : (
            <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
          )}
        </div>

        <div className="record-card">
          <h4 className="record-card-title">印刷记录卡</h4>

          <div className="record-item">
            <span className="record-label">印刷时间</span>
            <span className="record-value">{formatTimestamp(record.timestamp)}</span>
          </div>

          <div className="record-item">
            <span className="record-label">版心X偏移</span>
            <span className="record-value">{record.plateOffsetX.toFixed(1)} px</span>
          </div>

          <div className="record-item">
            <span className="record-label">版心Y偏移</span>
            <span className="record-value">{record.plateOffsetY.toFixed(1)} px</span>
          </div>

          <div className="record-item">
            <span className="record-label">墨色均匀度</span>
            <span className="record-value">{record.inkUniformity}%</span>
          </div>

          <div className="record-item">
            <span className="record-label">用墨量</span>
            <span className="record-value">{record.inkLevel}%</span>
          </div>

          <div className="record-item">
            <span className="record-label">压力值</span>
            <span className="record-value">{record.pressure}</span>
          </div>

          <div className="record-item">
            <span className="record-label">活字数量</span>
            <span className="record-value">{record.characters.length} 个</span>
          </div>

          <div className="record-seal">
            毕昇印
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintResult;
