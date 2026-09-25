import { PixelCanvas, type ToolType } from './pixel-canvas.ts';
import { ColorPicker, type ColorPickedEventDetail } from './color-picker.ts';
import { PixelToolbar, type ToolSelectedEventDetail } from './toolbar.ts';

function init(): void {
  const pixelCanvas = document.getElementById('pixelCanvas') as PixelCanvas;
  const toolbar = document.getElementById('toolbar') as PixelToolbar;
  const colorPicker = document.getElementById('colorPicker') as ColorPicker;
  const sizeSelect = document.getElementById('sizeSelect') as HTMLSelectElement;
  const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
  const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;

  if (!pixelCanvas || !toolbar || !colorPicker) {
    console.error('Required components not found');
    return;
  }

  const updateHistoryButtons = (): void => {
    undoBtn.disabled = !pixelCanvas.canUndo();
    redoBtn.disabled = !pixelCanvas.canRedo();
  };

  pixelCanvas.setColor(colorPicker.getColor());
  pixelCanvas.setTool(toolbar.getTool());

  updateHistoryButtons();

  pixelCanvas.addEventListener('historychange', () => {
    updateHistoryButtons();
  });

  toolbar.addEventListener('toolselected', ((e: CustomEvent<ToolSelectedEventDetail>) => {
    pixelCanvas.setTool(e.detail.tool);
  }) as EventListener);

  colorPicker.addEventListener('colorpicked', ((e: CustomEvent<ColorPickedEventDetail>) => {
    pixelCanvas.setColor(e.detail.color);
  }) as EventListener);

  pixelCanvas.addEventListener('pixelpicked', ((e: CustomEvent<{ color: string }>) => {
    colorPicker.setColor(e.detail.color);
  }) as EventListener);

  sizeSelect.addEventListener('change', () => {
    const newSize = parseInt(sizeSelect.value, 10);
    pixelCanvas.resetPixels(newSize);
  });

  undoBtn.addEventListener('click', () => {
    pixelCanvas.undo();
  });

  redoBtn.addEventListener('click', () => {
    pixelCanvas.redo();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
      return;
    }

    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    const shiftPressed = e.shiftKey;

    if (isCtrlOrMeta && e.key === 'z' && !shiftPressed) {
      e.preventDefault();
      undoBtn.click();
    }

    if (isCtrlOrMeta && (e.key === 'y' || (e.key === 'z' && shiftPressed))) {
      e.preventDefault();
      redoBtn.click();
    }

    if (e.key === '1' || e.key.toLowerCase() === 'p') {
      e.preventDefault();
      toolbar.setTool('pencil' as ToolType);
      pixelCanvas.setTool('pencil');
    }
    if (e.key === '2' || e.key.toLowerCase() === 'e') {
      e.preventDefault();
      toolbar.setTool('eraser' as ToolType);
      pixelCanvas.setTool('eraser');
    }
    if (e.key === '3' || e.key.toLowerCase() === 'i') {
      e.preventDefault();
      toolbar.setTool('picker' as ToolType);
      pixelCanvas.setTool('picker');
    }
    if (e.key === '4' || e.key.toLowerCase() === 'g') {
      e.preventDefault();
      toolbar.setTool('fill' as ToolType);
      pixelCanvas.setTool('fill');
    }

    if (e.key === 's' && isCtrlOrMeta) {
      e.preventDefault();
      exportBtn.click();
    }
  });

  exportBtn.addEventListener('click', () => {
    const sourceCanvas = pixelCanvas.toCanvas();
    const scale = 16;
    const size = pixelCanvas.getGridSize();
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = size * scale;
    exportCanvas.height = size * scale;
    const ctx = exportCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

    const dataUrl = exportCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `pixel-art-${size}x${size}-${Date.now()}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  window.addEventListener('resize', () => {
    pixelCanvas.refreshLayout();
  });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init, { once: true });
}
