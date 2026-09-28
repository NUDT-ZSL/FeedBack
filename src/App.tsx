import { useState, useRef, useEffect } from 'react';
import { PoemInput } from './PoemInput';
import { PaintingCanvas, Toolbar } from './PaintingCanvas';
import { defaultPoem, parseImagery, layoutImagery } from './utils/imagery';
import { drawPaperTexture, drawImageryElement } from './utils/inkElements';
import type { PoemData, BrushConfig, ImageryMatch } from './types';
import './styles/App.css';

function App() {
  const [poemData, setPoemData] = useState<PoemData>(defaultPoem);
  const [imageryMatches, setImageryMatches] = useState<ImageryMatch[]>([]);
  const [brushConfig, setBrushConfig] = useState<BrushConfig>({
    type: 'brush',
    color: '#2c2c2c',
    size: 8,
  });

  const imageryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const doodleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const matches = parseImagery(defaultPoem.content);
    setImageryMatches(matches);
  }, []);

  const handleRender = (matches: ImageryMatch[], poem: PoemData) => {
    setImageryMatches(matches);
    setPoemData(poem);
  };

  const handleSave = () => {
    const imageryCanvas = document.querySelector('.canvas-section canvas:first-child') as HTMLCanvasElement;
    const doodleCanvas = document.querySelector('.canvas-section canvas:last-child') as HTMLCanvasElement;

    if (!imageryCanvas || !doodleCanvas) {
      const canvases = document.querySelectorAll('canvas');
      if (canvases.length >= 2) {
        saveFromCanvases(canvases[0], canvases[1]);
      }
      return;
    }

    saveFromCanvases(imageryCanvas, doodleCanvas);
  };

  const saveFromCanvases = (canvas1: HTMLCanvasElement, canvas2: HTMLCanvasElement) => {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas1.width / dpr;
    const height = canvas1.height / dpr;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width * dpr;
    exportCanvas.height = height * dpr;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    ctx.drawImage(canvas1, 0, 0, width, height);
    ctx.drawImage(canvas2, 0, 0, width, height);

    const watermarkText = `${poemData.title || '无题'} · ${poemData.author || '佚名'} · ${formatDate(new Date())}`;

    ctx.font = '12px "KaiTi", "STKaiti", serif';
    ctx.fillStyle = 'rgba(102, 102, 102, 0.6)';
    ctx.textAlign = 'right';
    ctx.fillText(watermarkText, width - 20, height - 15);

    const dataUrl = exportCanvas.toDataURL('image/png');

    const link = document.createElement('a');
    link.download = `${poemData.title || '诗词意境'}_${formatDate(new Date(), true)}.png`;
    link.href = dataUrl;
    link.click();
  };

  const formatDate = (date: Date, forFile = false) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    if (forFile) {
      return `${y}${m}${d}_${h}${min}`;
    }
    return `${y}年${m}月${d}日 ${h}:${min}`;
  };

  const handleClearDoodle = () => {
    const doodleCanvas = document.querySelector('.canvas-section canvas:last-child') as HTMLCanvasElement;
    if (doodleCanvas) {
      const ctx = doodleCanvas.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, doodleCanvas.width / dpr, doodleCanvas.height / dpr);
      }
    }
  };

  return (
    <div className="app-container">
      <h1 className="app-title">诗词意境涂鸦墙</h1>

      <div className="main-content">
        <PoemInput
          onRender={handleRender}
          poemData={poemData}
          setPoemData={setPoemData}
        />

        <div className="canvas-section">
          <PaintingCanvas
            imageryMatches={imageryMatches}
            poemData={poemData}
            brushConfig={brushConfig}
          />
          <Toolbar
            brushConfig={brushConfig}
            setBrushConfig={setBrushConfig}
            onSave={handleSave}
            onClear={handleClearDoodle}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
