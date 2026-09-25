import { PixelCanvas, type ToolType } from './pixel-canvas.ts';
import { ColorPicker, type ColorPickedEventDetail } from './color-picker.ts';
import { PixelToolbar, type ToolSelectedEventDetail } from './toolbar.ts';
import { EditorStore, type CanvasSnapshot } from './editor-store.ts';

const EXPORT_SCALE = 16;

function snapshotToCanvas(snapshot: CanvasSnapshot): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.size;
  canvas.height = snapshot.size;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < snapshot.size; y++) {
    for (let x = 0; x < snapshot.size; x++) {
      ctx.fillStyle = snapshot.pixels[y][x];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
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

  // 单一数据源：尺寸、已提交像素、撤销/重做历史全部收敛在 store 中。
  const store = new EditorStore(pixelCanvas.getGridSize());

  const updateHistoryButtons = (): void => {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
  };
  store.subscribe(updateHistoryButtons);

  pixelCanvas.setColor(colorPicker.getColor());
  pixelCanvas.setTool(toolbar.getTool());

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
    // 一笔绘制结束（或画布被重置）才会触发，提交到 store；
    // 与已提交状态一致或是过期尺寸的事件会被 store 忽略。
    store.commit(pixelCanvas.getPixels());
  }) as EventListener);

  const applySnapshot = (snapshot: CanvasSnapshot): void => {
    // setPixels 不触发 canvaschange，应用历史快照是同步原子操作，
    // 快速连续撤销/重做也不会让画布与历史指针错位。
    pixelCanvas.setPixels(snapshot.pixels);
    if (sizeSelect.value !== String(snapshot.size)) {
      sizeSelect.value = String(snapshot.size);
    }
  };

  sizeSelect.addEventListener('change', () => {
    const newSize = parseInt(sizeSelect.value, 10);
    // 先重置 store（历史仅保留新尺寸初始快照），再重建画布；
    // resetPixels 触发的 canvaschange 与已提交状态一致，会被忽略。
    store.resize(newSize);
    pixelCanvas.resetPixels(newSize);
  });

  undoBtn.addEventListener('click', () => {
    const snapshot = store.undo();
    if (snapshot) {
      applySnapshot(snapshot);
    }
  });

  redoBtn.addEventListener('click', () => {
    const snapshot = store.redo();
    if (snapshot) {
      applySnapshot(snapshot);
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
    // 导出基于 store 中当前已提交状态，绘制过程中未落笔的
    // 中间像素不会进入导出结果。
    const snapshot = store.getSnapshot();
    const sourceCanvas = snapshotToCanvas(snapshot);
    const scale = EXPORT_SCALE;
    const size = snapshot.size;
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
