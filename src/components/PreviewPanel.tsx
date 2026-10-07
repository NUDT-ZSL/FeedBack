/**
 * 预览面板：接收配方与光源模式，通过 renderPaper 把引擎合成结果绘制到画布。
 * 入匣导出复用同一引擎，因此导出产物与页面所见一致。
 */

import { useEffect, useRef, useState } from 'react';
import type { LightMode, PaperRecipe } from '../core/types.ts';
import { renderPaper, getPaperEngine } from '../utils/paperRenderer.ts';
import { CanvasSurface } from '../utils/canvasSurface.ts';

interface PreviewPanelProps {
  recipe: PaperRecipe;
  lightMode: LightMode;
  onLightModeChange: (mode: LightMode) => void;
}

export default function PreviewPanel({ recipe, lightMode, onLightModeChange }: PreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shareText, setShareText] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPaper(canvas, recipe, lightMode);
  }, [recipe, lightMode]);

  const handleExport = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = getPaperEngine(canvas);
    if (!engine) return;
    const artifact = engine.export(lightMode);
    setShareText(artifact.shareText);
    const surface = artifact.surface as unknown as CanvasSurface;
    surface.canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `古风笺纸-${artifact.key.slice(0, 8)}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-4 p-6">
      <div className="flex items-center gap-3 text-sm text-[#5c3a21]">
        <span className={lightMode === 'daylight' ? 'font-semibold' : 'opacity-60'}>日光 6500K</span>
        <button
          type="button"
          role="switch"
          aria-checked={lightMode === 'candlelight'}
          onClick={() => onLightModeChange(lightMode === 'daylight' ? 'candlelight' : 'daylight')}
          className="relative h-6 w-12 rounded-full bg-[#8a5a2b]/30 transition-colors"
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#d4af37] shadow transition-all duration-300 ${
              lightMode === 'candlelight' ? 'left-6' : 'left-0.5'
            }`}
          />
        </button>
        <span className={lightMode === 'candlelight' ? 'font-semibold' : 'opacity-60'}>烛光 2700K</span>
      </div>

      <div
        className="rounded-sm border border-[#d4af37]/60 bg-white/30 p-3 shadow-lg transition-all duration-700"
        style={{ maxWidth: '100%' }}
      >
        <canvas
          ref={canvasRef}
          className="block max-h-[70vh] max-w-full object-contain"
          style={{ transition: 'filter 0.8s' }}
        />
      </div>

      <button
        type="button"
        onClick={handleExport}
        className="rounded border border-[#d4af37] bg-gradient-to-b from-[#7a4f28] to-[#5c3a21] px-8 py-2 font-['Ma_Shan_Zheng'] text-lg text-[#f5e6d3] shadow hover:-translate-y-0.5 hover:shadow-lg"
      >
        入 匣
      </button>

      {shareText && (
        <p className="max-w-md text-center text-xs text-[#5c3a21]/80">{shareText}</p>
      )}
    </div>
  );
}
