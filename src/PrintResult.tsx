import React, { useEffect, useRef, useState } from 'react';
import type { PrintRecord, PlacedCharacter } from './types';
import { 
  CELL_SIZE, 
  CANVAS_PADDING, 
  FONT_SIZE, 
  GRID_COLS,
  GRID_ROWS,
  getTextOpacity
} from './utils/printUtils';
import { computeRenderPlan, getRecordCardData } from './utils/printPipeline';
import { hashString, mulberry32 } from './utils/random';
import { playRevealSound } from './utils/audio';

interface PrintResultProps {
  record: PrintRecord | null;
  characters: PlacedCharacter[];
  inkLevel: number;
  pressure: number;
}

const PrintResult: React.FC<PrintResultProps> = ({ record, characters, inkLevel, pressure }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (characters.length === 0) return;

    setRevealed(false);
    const timer = setTimeout(() => {
      setRevealed(true);
      playRevealSound();
    }, 300);

    return () => clearTimeout(timer);
  }, [record]);

  useEffect(() => {
    if (!record || characters.length === 0) return;

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

    // 纸纹噪点使用由记录 id 派生的确定性随机源，
    // 同一份记录重复渲染时纹理与文字结果保持一致
    const textureRng = mulberry32(hashString(`${record.id}:texture`));
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 500; i++) {
      const x = textureRng() * canvasWidth;
      const y = textureRng() * canvasHeight;
      ctx.fillStyle = textureRng() > 0.5 ? '#8b7355' : '#d4c4a8';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;

    const plan = computeRenderPlan({
      ...record,
      inkLevel,
      pressure,
      characters,
    });

    ctx.font = `600 ${FONT_SIZE}px "Noto Serif SC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    plan.glyphs.forEach((glyph) => {
      ctx.globalAlpha = glyph.whiteSpot ? glyph.opacity * 0.3 : glyph.opacity;
      ctx.fillStyle = '#222222';
      ctx.fillText(glyph.char, glyph.x, glyph.y);

      if (glyph.ghost) {
        ctx.globalAlpha = glyph.opacity * 0.3;
        ctx.fillText(glyph.char, glyph.x + 0.5, glyph.y + 0.5);
      }
    });

    ctx.globalAlpha = 1;

    const elapsed = performance.now() - startTime;
    console.log(`Canvas rendering completed in ${elapsed.toFixed(2)}ms`);

    if (elapsed > 50) {
      console.warn('Canvas rendering exceeded 50ms target');
    }
  }, [record, characters, inkLevel, pressure]);

  if (!record || characters.length === 0) {
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
        const char = characters.find(c => c.row === row && c.col === col);
        
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
              opacity: char ? getTextOpacity(pressure, inkLevel) : 0,
              transform: `translate(${record.plateOffsetX + (char?.offsetX || 0)}px, ${record.plateOffsetY + (char?.offsetY || 0)}px)`
            }}
          >
            {char?.char || ''}
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

          {getRecordCardData(record).map((entry) => (
            <div className="record-item" key={entry.key}>
              <span className="record-label">{entry.label}</span>
              <span className="record-value">{entry.value}</span>
            </div>
          ))}
          
          <div className="record-seal">
            毕昇印
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintResult;
