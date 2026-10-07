import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { LanternRenderer } from './LanternRenderer';
import {
  PAINT_COLORS,
  SKELETONS,
  SILK_COLORS,
  LanternWork,
} from './types';
import { MessageKey } from './i18n';
import { useLanternStudio } from './store/useLanternStudio';
import { syncRendererWithWork } from './renderAdapter';
import './Workbench.css';

interface WorkbenchProps {
  t: (key: MessageKey) => string;
}

interface DragState {
  workId: string;
  mode: 'stroke' | 'line';
  points: { x: number; y: number }[];
  start: { x: number; y: number };
  color: string;
  radius: number;
}

const skeletonIconCache = new Map<string, string>();
const getSkeletonIcon = (skeletonId: string): string => {
  const cached = skeletonIconCache.get(skeletonId);
  if (cached) return cached;
  const def = SKELETONS.find((s) => s.id === skeletonId);
  const canvas = document.createElement('canvas');
  const renderer = new LanternRenderer(canvas);
  if (def) {
    renderer.drawSkeleton({
      paths: def.pathD,
      bounds: {
        x: def.viewBox.x,
        y: def.viewBox.y,
        width: def.viewBox.w,
        height: def.viewBox.h,
      },
    });
  }
  const url = renderer.exportPNG({ w: 96, h: 96 }, true, false);
  skeletonIconCache.set(skeletonId, url);
  return url;
};

export const Workbench: React.FC<WorkbenchProps> = ({ t }) => {
  const { current, dispatch } = useLanternStudio();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<LanternRenderer | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [paintHex, setPaintHex] = useState<string>(PAINT_COLORS[0].hex);
  const [brushRadius, setBrushRadius] = useState<number>(6);
  const [lineMode, setLineMode] = useState<boolean>(false);
  const [hint, setHint] = useState<string>('');

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!rendererRef.current) {
      rendererRef.current = new LanternRenderer(canvasRef.current);
    }
    syncRendererWithWork(rendererRef.current, current);
    dragRef.current = null;
  }, [current]);

  useEffect(() => {
    return () => {
      rendererRef.current?.stopAnimation();
    };
  }, []);

  const flashHint = (message: string) => {
    setHint(message);
    window.setTimeout(() => setHint(''), 2200);
  };

  const canvasPoint = (
    e: React.PointerEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * 400,
      y: ((e.clientY - rect.top) / rect.height) * 400,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!current) return;
    if (!current.skeleton) {
      flashHint(t('pleaseSelectSkeleton'));
      return;
    }
    if (!current.silkColor) {
      flashHint(t('pleaseSelectSilk'));
      return;
    }
    const point = canvasPoint(e);
    const renderer = rendererRef.current;
    if (!point || !renderer) return;

    canvasRef.current?.setPointerCapture(e.pointerId);
    const mode: DragState['mode'] = lineMode ? 'line' : 'stroke';
    dragRef.current = {
      workId: current.id,
      mode,
      points: [point],
      start: point,
      color: paintHex,
      radius: brushRadius,
    };

    if (mode === 'stroke') {
      renderer.setTemporaryStroke({ points: [point], color: paintHex, radius: brushRadius });
    } else {
      renderer.setTemporaryLine({ start: point, end: point, color: paintHex, radius: brushRadius });
    }
    renderer.render();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const renderer = rendererRef.current;
    if (!drag || !renderer) return;
    const point = canvasPoint(e);
    if (!point) return;

    if (drag.mode === 'stroke') {
      drag.points.push(point);
      renderer.setTemporaryStroke({
        points: drag.points,
        color: drag.color,
        radius: drag.radius,
      });
    } else {
      renderer.setTemporaryLine({
        start: drag.start,
        end: point,
        color: drag.color,
        radius: drag.radius,
      });
    }
    renderer.render();
  };

  const finishDrag = (commit: boolean) => {
    const drag = dragRef.current;
    const renderer = rendererRef.current;
    dragRef.current = null;
    if (!drag || !renderer) return;

    renderer.setTemporaryStroke(null);
    renderer.setTemporaryLine(null);

    if (commit) {
      if (drag.mode === 'stroke' && drag.points.length >= 1) {
        dispatch({
          type: 'commitStroke',
          workId: drag.workId,
          stroke: {
            points: drag.points,
            color: drag.color,
            radius: drag.radius,
          },
        });
      } else if (drag.mode === 'line') {
        const endPoint = drag.points[drag.points.length - 1] ?? drag.start;
        if (endPoint.x !== drag.start.x || endPoint.y !== drag.start.y) {
          dispatch({
            type: 'commitLine',
            workId: drag.workId,
            line: {
              start: drag.start,
              end: endPoint,
              color: drag.color,
              radius: drag.radius,
            },
          });
        }
      }
    }
    renderer.render();
  };

  const handlePointerUp = () => finishDrag(true);
  const handlePointerCancel = () => finishDrag(false);

  const handleLightUp = () => {
    if (!current) return;
    if (!current.skeleton) {
      flashHint(t('pleaseSelectSkeleton'));
      return;
    }
    if (!current.silkColor) {
      flashHint(t('pleaseSelectSilk'));
      return;
    }
    if (current.isLit || rendererRef.current?.isLighting) return;

    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.generateBurnSound();
    renderer.startLightingAnimation(() => {
      dispatch({ type: 'setLit', isLit: true });
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#ffaa44', '#ffe8b0', '#ffd700', '#c04040'],
      });
    });
  };

  const handleSave = () => {
    if (!current) return;
    if (!current.isLit) {
      flashHint(t('needLitToSave'));
      return;
    }
    dispatch({ type: 'saveCurrent' });
    flashHint(t('saved'));
  };

  const handleDownload = () => {
    const renderer = rendererRef.current;
    if (!renderer || !current?.skeleton) {
      flashHint(t('pleaseSelectSkeleton'));
      return;
    }
    const url = renderer.exportPNG({ w: 512, h: 512 }, true, current.isLit);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lantern_${current.randomId}.png`;
    link.click();
  };

  const handleClear = () => {
    if (!current) return;
    rendererRef.current?.stopAnimation();
    dispatch({ type: 'clearCurrent' });
  };

  const canDraw = Boolean(current?.skeleton && current?.silkColor);

  const skeletonIcons = useMemo(() => {
    const map = new Map<string, string>();
    for (const sk of SKELETONS) map.set(sk.id, getSkeletonIcon(sk.id));
    return map;
  }, []);

  return (
    <section className="workbench">
      <div className="cabinet panel">
        <h3>{t('skeletonTitle')}</h3>
        <div className="skeleton-list">
          {SKELETONS.map((sk, index) => (
            <button
              key={sk.id}
              type="button"
              className={`skeleton-card${current?.skeleton === sk.id ? ' selected' : ''}`}
              onClick={() => dispatch({ type: 'setSkeleton', skeletonId: sk.id })}
              title={sk.name.zh}
            >
              <img src={skeletonIcons.get(sk.id)} alt={sk.name.zh} />
              <span>
                {index === 0
                  ? t('rabbitLantern')
                  : index === 1
                    ? t('lotusLantern')
                    : t('palaceLantern')}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="center-stage">
        <div className="canvas-frame panel">
          <canvas
            ref={canvasRef}
            className={`lantern-canvas${canDraw ? '' : ' disabled'}`}
            width={400}
            height={400}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          />
          {current?.randomId && (
            <div className="work-badge">
              {t('current')} · {current.randomId}
            </div>
          )}
          {hint && <div className="hint-toast">{hint}</div>}
        </div>

        <div className="silk-tray panel">
          <h3>{t('silkTitle')}</h3>
          <div className="silk-list">
            {SILK_COLORS.map((silk) => (
              <button
                key={silk.id}
                type="button"
                className={`silk-swatch${current?.silkColor === silk.id ? ' selected' : ''}`}
                style={{
                  backgroundColor: silk.hex,
                  opacity: current?.skeleton ? silk.opacity + 0.3 : 0.3,
                }}
                disabled={!current?.skeleton}
                onClick={() => dispatch({ type: 'setSilk', silkId: silk.id })}
                title={silk.name.zh}
              />
            ))}
          </div>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="btn primary"
            onClick={handleLightUp}
            disabled={!canDraw || current?.isLit}
          >
            {current?.isLit ? '✦ ' : ''}
            {t('lightUp')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleSave}
            disabled={!canDraw || !current?.isLit}
          >
            {t('saveLantern')}
          </button>
          <button type="button" className="btn" onClick={handleDownload} disabled={!current?.skeleton}>
            {t('downloadPNG')}
          </button>
          <button type="button" className="btn ghost" onClick={handleClear} disabled={!current}>
            {t('clearWork')}
          </button>
        </div>
      </div>

      <div className="paint-shelf panel">
        <h3>{t('paintTitle')}</h3>
        <div className="paint-grid">
          {PAINT_COLORS.map((paint) => (
            <button
              key={paint.id}
              type="button"
              className={`paint-swatch${paintHex === paint.hex ? ' selected' : ''}`}
              style={{ backgroundColor: paint.hex }}
              onClick={() => setPaintHex(paint.hex)}
              title={paint.name.zh}
            />
          ))}
        </div>
        <label className="brush-control">
          <span>{t('brushSize')}: {brushRadius}px</span>
          <input
            type="range"
            min={4}
            max={12}
            step={1}
            value={brushRadius}
            onChange={(e) => setBrushRadius(Number(e.target.value))}
          />
        </label>
        <div className="mode-toggle">
          <button
            type="button"
            className={`btn small${!lineMode ? ' active' : ''}`}
            onClick={() => setLineMode(false)}
          >
            {t('drawMode')}
          </button>
          <button
            type="button"
            className={`btn small${lineMode ? ' active' : ''}`}
            onClick={() => setLineMode(true)}
          >
            {t('lineMode')}
          </button>
        </div>
        <p className="draw-hint">{canDraw ? t('drawYourPattern') : t('pleaseSelectSkeleton')}</p>
      </div>
    </section>
  );
};
