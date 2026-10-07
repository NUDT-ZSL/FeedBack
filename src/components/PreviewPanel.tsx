/**
 * 预览面板：消费管线的渲染结果（RenderResult），只负责绘制与查看交互。
 * - 纸面指令与光源罩染分离：切光源只改罩层颜色（0.8s 过渡），任何渲染层不失效；
 * - 缩放/旋转为纯查看变换，不影响渲染结果与导出产物。
 */

import { useEffect, useRef, useState } from 'react';
import { paintOps, type PaintContext } from '@/core/displayList';
import type { RenderResult } from '@/core/pipeline';
import { LIGHT_TINTS, type LightMode } from '@/core/types';

interface PreviewPanelProps {
  result: RenderResult;
  lightMode: LightMode;
  onLightModeChange: (mode: LightMode) => void;
  onExport: () => void;
}

export default function PreviewPanel({ result, lightMode, onLightModeChange, onExport }: PreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // 仅当渲染结果变化时重绘（result.paperOps 引用不变则不触发）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = result.size.width;
    canvas.height = result.size.height;
    const ctx = canvas.getContext('2d');
    if (ctx) paintOps(ctx as unknown as PaintContext, result.paperOps);
  }, [result]);

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div className="light-switch" role="switch" aria-checked={lightMode === 'candlelight'}>
          <span className={lightMode === 'daylight' ? 'active' : ''}>日光</span>
          <button
            className={`switch-track ${lightMode}`}
            onClick={() => onLightModeChange(lightMode === 'daylight' ? 'candlelight' : 'daylight')}
            aria-label="切换光源"
          >
            <span className="switch-thumb" />
          </button>
          <span className={lightMode === 'candlelight' ? 'active' : ''}>烛光</span>
        </div>
        <div className="view-controls">
          <button className="wood-btn tiny" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="wood-btn tiny" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2)))}>＋</button>
          <button className="wood-btn tiny" onClick={() => setRotation((r) => (r + 90) % 360)}>旋转</button>
          <button className="wood-btn primary" onClick={onExport}>入匣</button>
        </div>
      </div>

      <div className="scroll-stage">
        <div
          className="paper-frame"
          style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
        >
          <canvas ref={canvasRef} className="paper-canvas" />
          {/* 光源罩染：与导出使用的 LIGHT_TINTS 同值，0.8s 平滑过渡 */}
          <div className="light-tint" style={{ backgroundColor: LIGHT_TINTS[lightMode] }} />
        </div>
      </div>
    </div>
  );
}
