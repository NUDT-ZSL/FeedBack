import { PixelCanvas, type PixelData, type ToolType } from './pixel-canvas.ts';
import { ColorPicker, type ColorPickedEventDetail } from './color-picker.ts';
import { PixelToolbar, type ToolSelectedEventDetail } from './toolbar.ts';

const MAX_HISTORY = 30;

class HistoryManager {
  private undoStack: PixelData[] = [];
  private redoStack: PixelData[] = [];
  private currentSnapshot: PixelData | null = null;

  public push(snapshot: PixelData): void {
    if (this.currentSnapshot !== null) {
      this.deepPush(this.undoStack, this.currentSnapshot);
    }
    this.currentSnapshot = this.deepClone(snapshot);
    this.redoStack = [];
  }

  public undo(): PixelData | null {
    if (this.undoStack.length === 0) return null;
    if (this.currentSnapshot !== null) {
      this.deepPush(this.redoStack, this.currentSnapshot);
    }
    const snapshot = this.undoStack.pop()!;
    this.currentSnapshot = this.deepClone(snapshot);
    return snapshot;
  }

  public redo(): PixelData | null {
    if (this.redoStack.length === 0) return null;
    if (this.currentSnapshot !== null) {
      this.deepPush(this.undoStack, this.currentSnapshot);
    }
    const snapshot = this.redoStack.pop()!;
    this.currentSnapshot = this.deepClone(snapshot);
    return snapshot;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.currentSnapshot = null;
  }

  private deepPush(stack: PixelData[], data: PixelData): void {
    stack.push(this.deepClone(data));
    if (stack.length > MAX_HISTORY) {
      stack.shift();
    }
  }

  private deepClone(data: PixelData): PixelData {
    const result: PixelData = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const newRow = new Array(row.length);
      for (let j = 0; j < row.length; j++) {
        newRow[j] = row[j];
      }
      result[i] = newRow;
    }
    return result;
  }
}

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

  const history = new HistoryManager();
  let isHistoryAction = false;

  const updateHistoryButtons = (): void => {
    undoBtn.disabled = !history.canUndo();
    redoBtn.disabled = !history.canRedo();
  };

  pixelCanvas.setColor(colorPicker.getColor());
  pixelCanvas.setTool(toolbar.getTool());

  const initialSnapshot = pixelCanvas.getPixels();
  history.push(initialSnapshot);
  updateHistoryButtons();

  toolbar.addEventListener('toolselected', ((e: CustomEvent<ToolSelectedEventDetail>) => {
    pixelCanvas.setTool(e.detail.tool);
  }) as EventListener);

  colorPicker.addEventListener('colorpicked', ((e: CustomEvent<ColorPickedEventDetail>) => {
    pixelCanvas.setColor(e.detail.color);
  }) as EventListener);

  pixelCanvas.addEventListener('pixelpicked', ((e: CustomEvent<{ color: string }>) => {
    colorPicker.setColor(e.detail.color);
  }) as EventListener);

  pixelCanvas.addEventListener('canvaschange', (() => {
    if (isHistoryAction) {
      isHistoryAction = false;
      return;
    }
    const snapshot = pixelCanvas.getPixels();
    history.push(snapshot);
    updateHistoryButtons();
  }) as EventListener);

  sizeSelect.addEventListener('change', () => {
    const newSize = parseInt(sizeSelect.value, 10);
    history.reset();
    pixelCanvas.resetPixels(newSize);
    const snapshot = pixelCanvas.getPixels();
    history.push(snapshot);
    updateHistoryButtons();
  });

  undoBtn.addEventListener('click', () => {
    const snapshot = history.undo();
    if (snapshot) {
      isHistoryAction = true;
      pixelCanvas.setPixels(snapshot);
      updateHistoryButtons();
    }
  });

  redoBtn.addEventListener('click', () => {
    const snapshot = history.redo();
    if (snapshot) {
      isHistoryAction = true;
      pixelCanvas.setPixels(snapshot);
      updateHistoryButtons();
    }
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
    const currentPixels = pixelCanvas.getPixels();
    const currentSize = pixelCanvas.getGridSize();
    pixelCanvas.setPixels(currentPixels);
    pixelCanvas.setAttribute('size', String(currentSize));
  });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init, { once: true });
}
