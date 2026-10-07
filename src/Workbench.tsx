import { PointerEvent as ReactPointerEvent, useContext, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { LanternRenderer } from './LanternRenderer';
import { LocaleContext } from './LocaleContext';
import { BrushStroke, Line, PAINT_COLORS, SILK_COLORS, SKELETONS, Skeleton, Work } from './types';
import { loadWorkIntoRenderer, toRendererSkeleton } from './workUtils';

interface WorkbenchProps {
  work: Work;
  onUpdate: (id: string, patch: Partial<Work>) => void;
  onAddStroke: (id: string, stroke: BrushStroke) => void;
  onAddLine: (id: string, line: Line) => void;
  onSave: (id: string) => void;
  onDownload: (work: Work) => void;
  onClear: (id: string) => void;
}

function SkeletonPreview({ skeleton }: { skeleton: Skeleton }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new LanternRenderer(canvas);
    const rendererSkeleton = toRendererSkeleton(skeleton.id);
    if (rendererSkeleton) {
      renderer.drawSkeleton(rendererSkeleton);
    }
  }, [skeleton]);

  return <canvas ref={canvasRef} className="skeleton-preview" />;
}

export default function Workbench({
  work,
  onUpdate,
  onAddStroke,
  onAddLine,
  onSave,
  onDownload,
  onClear,
}: WorkbenchProps) {
  const { locale, t } = useContext(LocaleContext);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LanternRenderer | null>(null);

  const [paintHex, setPaintHex] = useState(PAINT_COLORS[0].hex);
  const [brushRadius, setBrushRadius] = useState(8);
  const [lineMode, setLineMode] = useState(false);
  const [hint, setHint] = useState<string>('');

  const isDrawingRef = useRef(false);
  const strokeWorkIdRef = useRef<string | null>(null);
  const tempPointsRef = useRef<{ x: number; y: number }[] | null>(null);
  const tempLineRef = useRef<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const prevWorkIdRef = useRef<string | null>(null);
  const hintTimerRef = useRef<number | null>(null);

  const canDraw = Boolean(work.skeletonId && work.silkColorId);

  useEffect(() => {
    if (canvasRef.current && !rendererRef.current) {
      rendererRef.current = new LanternRenderer(canvasRef.current);
    }
    return () => {
      rendererRef.current?.stopAnimation();
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (prevWorkIdRef.current !== work.id) {
      isDrawingRef.current = false;
      strokeWorkIdRef.current = null;
      tempPointsRef.current = null;
      tempLineRef.current = null;
      prevWorkIdRef.current = work.id;
    }

    loadWorkIntoRenderer(renderer, work);
  }, [work]);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current !== null) {
        window.clearTimeout(hintTimerRef.current);
      }
    };
  }, []);

  const flashHint = (text: string) => {
    setHint(text);
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
    }
    hintTimerRef.current = window.setTimeout(() => setHint(''), 2500);
  };

  const getCanvasPos = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 400,
      y: ((event.clientY - rect.top) / rect.height) * 400,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!work.skeletonId) {
      flashHint(t('pleaseSelectSkeleton'));
      return;
    }
    if (!work.silkColorId) {
      flashHint(t('pleaseSelectSilk'));
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
    strokeWorkIdRef.current = work.id;

    const pos = getCanvasPos(event);
    if (lineMode) {
      tempLineRef.current = { start: pos, end: pos };
      renderer.setTemporaryLine({ start: pos, end: pos, color: paintHex, radius: brushRadius });
    } else {
      tempPointsRef.current = [pos];
      renderer.setTemporaryStroke({ points: [pos], color: paintHex, radius: brushRadius });
    }
    renderer.render();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer || !isDrawingRef.current) return;

    const pos = getCanvasPos(event);
    if (lineMode && tempLineRef.current) {
      tempLineRef.current = { start: tempLineRef.current.start, end: pos };
      renderer.setTemporaryLine({ start: tempLineRef.current.start, end: pos, color: paintHex, radius: brushRadius });
    } else if (tempPointsRef.current) {
      tempPointsRef.current.push(pos);
      renderer.setTemporaryStroke({ points: [...tempPointsRef.current], color: paintHex, radius: brushRadius });
    }
    renderer.render();
  };

  const handlePointerUp = () => {
    const renderer = rendererRef.current;
    if (!renderer || !isDrawingRef.current) return;

    isDrawingRef.current = false;
    renderer.setTemporaryStroke(null);
    renderer.setTemporaryLine(null);

    const targetWorkId = strokeWorkIdRef.current;
    strokeWorkIdRef.current = null;

    if (targetWorkId !== work.id) {
      tempPointsRef.current = null;
      tempLineRef.current = null;
      renderer.render();
      return;
    }

    if (lineMode && tempLineRef.current) {
      const { start, end } = tempLineRef.current;
      onAddLine(work.id, { start, end, color: paintHex, radius: brushRadius });
    } else if (tempPointsRef.current && tempPointsRef.current.length > 0) {
      const points = [...tempPointsRef.current];
      if (points.length === 1) {
        points.push({ ...points[0] });
      }
      onAddStroke(work.id, { points, color: paintHex, radius: brushRadius });
    }

    tempPointsRef.current = null;
    tempLineRef.current = null;
  };

  const handleLightUp = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!work.skeletonId) {
      flashHint(t('pleaseSelectSkeleton'));
      return;
    }
    if (!work.silkColorId) {
      flashHint(t('pleaseSelectSilk'));
      return;
    }

    try {
      renderer.generateBurnSound();
    } catch {
    }
    renderer.startLightingAnimation(() => {
      onUpdate(work.id, { isLit: true });
      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#ffe8b0', '#ff8800', '#c04040'],
      });
    });
  };

  const handleSave = () => {
    if (!work.skeletonId) {
      flashHint(t('pleaseSelectSkeleton'));
      return;
    }
    if (!work.silkColorId) {
      flashHint(t('pleaseSelectSilk'));
      return;
    }
    onSave(work.id);
    flashHint(t('savedToWall'));
  };

  const handleDownload = () => {
    if (!work.skeletonId) {
      flashHint(t('pleaseSelectSkeleton'));
      return;
    }
    onDownload(work);
  };

  return (
    <div className="workbench-grid">
      <aside className="panel">
        <h3>{t('skeletonTitle')}</h3>
        {SKELETONS.map((skeleton) => (
          <button
            key={skeleton.id}
            type="button"
            className={`skeleton-card${work.skeletonId === skeleton.id ? ' selected' : ''}`}
            onClick={() => onUpdate(work.id, { skeletonId: skeleton.id })}
            data-testid={`skeleton-${skeleton.id}`}
          >
            <SkeletonPreview skeleton={skeleton} />
            <span className="skeleton-name">{locale === 'zh' ? skeleton.name.zh : skeleton.name.en}</span>
          </button>
        ))}

        <h3>{t('silkTitle')}</h3>
        <div className="silk-grid">
          {SILK_COLORS.map((silk) => (
            <button
              key={silk.id}
              type="button"
              className={`silk-swatch${work.silkColorId === silk.id ? ' selected' : ''}`}
              style={{ backgroundColor: silk.hex }}
              title={locale === 'zh' ? silk.name.zh : silk.name.en}
              disabled={!work.skeletonId}
              onClick={() => onUpdate(work.id, { silkColorId: silk.id })}
              data-testid={`silk-${silk.id}`}
            />
          ))}
        </div>
      </aside>

      <section className="canvas-stage">
        <div className="canvas-frame">
          <canvas
            ref={canvasRef}
            className={`lantern-canvas ${canDraw ? 'ready' : 'locked'}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            data-testid="lantern-canvas"
          />
        </div>
        <div className="hint-bar" data-testid="hint-bar">
          {hint || (canDraw ? t('drawYourPattern') : '')}
        </div>
        <div className="stage-actions">
          <button type="button" className="btn" onClick={handleLightUp} data-testid="light-up">
            {t('lightUp')}
          </button>
          <button type="button" className="btn" onClick={handleSave} data-testid="save-lantern">
            {t('saveLantern')}
          </button>
          <button type="button" className="btn" onClick={handleDownload} data-testid="download-png">
            {t('downloadPNG')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onClear(work.id)}
            data-testid="clear-work"
          >
            {t('clearWork')}
          </button>
        </div>
      </section>

      <aside className="panel">
        <h3>{t('paintTitle')}</h3>
        <div className="paint-grid">
          {PAINT_COLORS.map((paint) => (
            <button
              key={paint.id}
              type="button"
              className={`paint-swatch${paintHex === paint.hex ? ' selected' : ''}`}
              style={{ backgroundColor: paint.hex }}
              title={locale === 'zh' ? paint.name.zh : paint.name.en}
              onClick={() => setPaintHex(paint.hex)}
              data-testid={`paint-${paint.id}`}
            />
          ))}
        </div>

        <div className="brush-row">
          <label htmlFor="brush-size">
            {t('brushSize')}: {brushRadius}px
          </label>
          <input
            id="brush-size"
            type="range"
            min={4}
            max={12}
            value={brushRadius}
            onChange={(event) => setBrushRadius(Number(event.target.value))}
          />
        </div>

        <div className="mode-row">
          <button
            type="button"
            className={`btn mode-btn${!lineMode ? ' active' : ''}`}
            onClick={() => setLineMode(false)}
            data-testid="draw-mode"
          >
            {t('drawMode')}
          </button>
          <button
            type="button"
            className={`btn mode-btn${lineMode ? ' active' : ''}`}
            onClick={() => setLineMode(true)}
            data-testid="line-mode"
          >
            {t('lineMode')}
          </button>
        </div>
      </aside>
    </div>
  );
}
